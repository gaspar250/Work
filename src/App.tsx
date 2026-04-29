import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Search, 
  MapPin, 
  Star, 
  MessageSquare, 
  User, 
  Briefcase, 
  ChevronRight, 
  ArrowLeft, 
  Send, 
  CreditCard, 
  CheckCircle2,
  Check,
  Menu,
  X,
  Plus,
  Camera,
  Filter,
  Settings,
  LogOut,
  Hammer,
  Home,
  Paintbrush,
  Zap,
  Droplets,
  Wrench,
  Bell,
  AlertCircle,
  WifiOff,
  Clock,
  Mic,
  LayoutDashboard,
  TrendingUp,
  Award,
  DollarSign,
  Sparkles,
  Flower2,
  ChefHat,
  Truck,
  Baby,
  Shield,
  Monitor,
  GraduationCap,
  Palette,
  Presentation,
  Calendar,
  Navigation,
  Share2,
  Copy,
  Save,
  ExternalLink,
  Facebook,
  Twitter,
  Linkedin,
  Heart,
  Phone,
  MessageCircle,
  Loader2,
  Moon,
  Sun,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { cn } from './lib/utils';
import { auth, db, messaging, storage } from './firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  ref as storageRef, 
  uploadBytes, 
  uploadBytesResumable,
  getDownloadURL 
} from 'firebase/storage';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  orderBy,
  limit,
  deleteDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Component to handle map clicks and set user location
const MapClickHandler = ({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) => {
  useMapEvents({
    click: (e) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

const MapCenterTracker = ({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) => {
  useMapEvents({
    moveend: (e) => {
      const center = e.target.getCenter();
      onCenterChange(center.lat, center.lng);
    },
  });
  return null;
};

// Firestore Error Types and Helpers
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error('Erro de permissão.');
  throw new Error(JSON.stringify(errInfo));
};

// Fix for Leaflet default icon
let DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

// Haversine formula to calculate distance in km
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Helper to notify nearby providers via in-app and push notifications
const notifyProviders = async (jobId: string, category: string, clientName: string, location: { lat: number, lng: number }) => {
  try {
    const providersQuery = query(
      collection(db, 'users'),
      where('role', 'in', ['provider', 'both']),
      where('skills', 'array-contains', category)
    );
    
    const providersSnapshot = await getDocs(providersQuery);
    const tokensToSend: string[] = [];

    for (const docSnap of providersSnapshot.docs) {
      const provider = docSnap.data();
      if (!provider.lat || !provider.lng) continue;
      
      // Calculate distance (using the same calculateDistance function defined later, 
      // but we need to make sure it's available or define it here)
      // For now, I'll assume calculateDistance is available globally or I'll move it up.
      const dist = calculateDistance(location.lat, location.lng, provider.lat, provider.lng);
      
      if (dist <= 10) { // 10km radius
        await addDoc(collection(db, 'notifications'), {
          userId: docSnap.id,
          title: 'Nova Oferta de Serviço!',
          body: `${clientName} precisa de um ${category} perto de você.`,
          type: 'job_offer',
          jobId: jobId,
          read: false,
          createdAt: serverTimestamp(),
        });
        
        if (provider.fcmToken) {
          tokensToSend.push(provider.fcmToken);
        }
      }
    }

    if (tokensToSend.length > 0) {
      await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: tokensToSend,
          title: 'Nova Oferta de Serviço!',
          body: `${clientName} precisa de um ${category} perto de você.`,
          data: {
            view: 'job_offers',
            jobId: jobId
          }
        })
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'notifications');
  }
};

L.Marker.prototype.options.icon = DefaultIcon;

import { SudokuGame } from './components/SudokuGame';

// Types
type View = 'home' | 'search' | 'profile' | 'chat' | 'tasks' | 'payment' | 'job_offers' | 'chats' | 'dashboard' | 'sudoku' | 'schedules' | 'favorites';
type Language = 'pt' | 'en';
type Theme = 'light' | 'dark';

const translations = {
  pt: {
    settings: 'Configurações',
    theme: 'Tema',
    language: 'Idioma',
    light: 'Claro',
    dark: 'Escuro',
    notifications: 'Notificações',
    profile: 'Perfil',
    home: 'Início',
    search: 'Buscar',
    tasks: 'Tarefas',
    chats: 'Conversas',
    favorites: 'Favoritos',
    schedules: 'Agendamentos',
    appearance: 'Aparência',
    preferences: 'Preferências',
    save: 'Salvar',
    cancel: 'Cancelar',
    logout: 'Sair',
    availableNow: 'Disponível agora',
    unavailable: 'Indisponível no momento',
    canRespondInMinutes: 'Pode responder em minutos',
    respondsInHours: 'Responde em algumas horas',
    availability: 'Disponibilidade',
    myTasks: 'Minhas Tarefas',
    notificationSettings: 'Configurações de Notificação',
    reminderLeadTime: 'Lembrete de Agendamento',
    reminderDescription: 'Receba um lembrete antes do início de cada serviço agendado.',
    pushNotifications: 'Notificações Push',
    status: 'Status',
    activated: 'Ativado',
    deactivated: 'Desativado',
    enable: 'Ativar',
    minutes: 'Minutos',
    hours: 'Horas',
    hours_plural: 'Horas',
    day_singular: 'Dia',
    day_plural: 'Dias',
    before: 'de antecedência',
    editPhone: 'Seu Telefone',
    notInformed: 'Não informado',
    tapToChange: 'Toque para alterar',
    tapToAdd: 'Toque para adicionar',
    yourBio: 'Sobre você',
    editBio: 'Editar Bio',
    skills: 'Habilidades',
    portfolio: 'Portfólio',
    reviews: 'Avaliações',
    becomeProvider: 'Ser um Prestador',
    updateProfilePhoto: 'Atualizar Foto de Perfil',
    useCamera: 'Usar Câmera',
    takePhoto: 'Tirar Foto',
    selectFromDevice: 'Selecionar do Dispositivo'
  },
  en: {
    settings: 'Settings',
    theme: 'Theme',
    language: 'Language',
    light: 'Light',
    dark: 'Dark',
    notifications: 'Notifications',
    profile: 'Profile',
    home: 'Home',
    search: 'Search',
    tasks: 'Tasks',
    chats: 'Chats',
    favorites: 'Favorites',
    schedules: 'Schedules',
    appearance: 'Appearance',
    preferences: 'Preferences',
    save: 'Save',
    cancel: 'Cancel',
    logout: 'Logout',
    availableNow: 'Available now',
    unavailable: 'Unavailable right now',
    canRespondInMinutes: 'Can respond in minutes',
    respondsInHours: 'Responds in a few hours',
    availability: 'Availability',
    myTasks: 'My Tasks',
    notificationSettings: 'Notification Settings',
    reminderLeadTime: 'Scheduling Reminder',
    reminderDescription: 'Receive a reminder before the start of each scheduled service.',
    pushNotifications: 'Push Notifications',
    status: 'Status',
    activated: 'Enabled',
    deactivated: 'Disabled',
    enable: 'Enable',
    minutes: 'Minutes',
    hours: 'Hour',
    hours_plural: 'Hours',
    day_singular: 'Day',
    day_plural: 'Days',
    before: 'in advance',
    editPhone: 'Your Phone',
    notInformed: 'Not informed',
    tapToChange: 'Tap to change',
    tapToAdd: 'Tap to add',
    yourBio: 'About you',
    editBio: 'Edit Bio',
    skills: 'Skills',
    portfolio: 'Portfolio',
    reviews: 'Reviews',
    becomeProvider: 'Become a Provider',
    updateProfilePhoto: 'Update Profile Photo',
    useCamera: 'Use Camera',
    takePhoto: 'Take Photo',
    selectFromDevice: 'Select from Device'
  }
};

interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  imageURL: string;
}

interface TaskUser {
  uid: string;
  name: string;
  role: 'client' | 'provider' | 'both';
  bio?: string;
  skills?: string[];
  rating?: number;
  reviewCount?: number;
  photoURL?: string;
  lat?: number;
  lng?: number;
  isOnline?: boolean;
  lastSeen?: any;
  fcmToken?: string;
  phone?: string;
  portfolio?: PortfolioItem[];
}

interface Review {
  id: string;
  taskId: string;
  clientId: string;
  providerId: string;
  clientName: string;
  rating: number;
  comment: string;
  createdAt: any;
}

interface Task {
  id: string;
  clientId: string;
  clientName: string;
  providerId: string;
  providerName: string;
  title: string;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  price?: number;
  rated?: boolean;
  scheduledAt?: any;
  clientReminderSent?: boolean;
  providerReminderSent?: boolean;
  reminderSent?: boolean;
  createdAt: any;
}

interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  type?: 'text' | 'proposal';
  price?: number;
  proposalStatus?: 'pending' | 'accepted' | 'rejected';
  taskId?: string;
  createdAt: any;
  isOffline?: boolean;
}

interface Job {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  description: string;
  category: string;
  lat: number;
  lng: number;
  createdAt: any;
}

// Mock Data for initial view
const MOCK_PROVIDERS: TaskUser[] = [
  {
    uid: 'p1',
    name: 'João Silva',
    role: 'provider',
    bio: 'Eletricista certificado com 10 anos de experiência. Especialista em instalações residenciais.',
    skills: ['Eletricista', 'Reparos'],
    rating: 4.8,
    reviewCount: 124,
    photoURL: 'https://picsum.photos/seed/p1/200/200',
    lat: -8.839988,
    lng: 13.289437,
    isOnline: true,
    portfolio: [
      { id: 'pf1', title: 'Reforma Elétrica', description: 'Troca completa de fiação em apartamento de 3 quartos.', imageURL: 'https://picsum.photos/seed/elec1/400/300' },
      { id: 'pf2', title: 'Quadro de Luz', description: 'Instalação de novo quadro de disjuntores padrão moderno.', imageURL: 'https://picsum.photos/seed/elec2/400/300' }
    ]
  },
  {
    uid: 'p2',
    name: 'Maria Santos',
    role: 'provider',
    bio: 'Pintora profissional. Acabamentos de alta qualidade e rapidez.',
    skills: ['Pintor', 'Decoração'],
    rating: 4.9,
    reviewCount: 89,
    photoURL: 'https://picsum.photos/seed/p2/200/200',
    lat: -8.8147,
    lng: 13.2306,
    isOnline: true,
    portfolio: [
      { id: 'pf3', title: 'Pintura Interna', description: 'Aplicação de tinta acetinada em sala de estar.', imageURL: 'https://picsum.photos/seed/paint1/400/300' },
      { id: 'pf4', title: 'Texturização', description: 'Efeito cimento queimado em parede de destaque.', imageURL: 'https://picsum.photos/seed/paint2/400/300' }
    ]
  },
  {
    uid: 'p3',
    name: 'Carlos Oliveira',
    role: 'provider',
    bio: 'Encanador disponível 24h para emergências.',
    skills: ['Encanador', 'Hidráulica'],
    rating: 4.7,
    reviewCount: 56,
    photoURL: 'https://picsum.photos/seed/p3/200/200',
    lat: -8.8583,
    lng: 13.2344,
    isOnline: false,
    portfolio: [
      { id: 'pf5', title: 'Vazamento Banheiro', description: 'Reparo de infiltração em tubulação de esgoto.', imageURL: 'https://picsum.photos/seed/plumb1/400/300' }
    ]
  }
];

const CATEGORIES = [
  { name: 'Eletricista', icon: Zap, color: 'bg-yellow-100 text-yellow-600' },
  { name: 'Pintor', icon: Paintbrush, color: 'bg-blue-100 text-blue-600' },
  { name: 'Encanador', icon: Droplets, color: 'bg-cyan-100 text-cyan-600' },
  { name: 'Pedreiro', icon: Hammer, color: 'bg-orange-100 text-orange-600' },
  { name: 'Mecânico', icon: Wrench, color: 'bg-gray-100 text-gray-600' },
  { name: 'Limpeza', icon: Sparkles, color: 'bg-purple-100 text-purple-600' },
  { name: 'Jardineiro', icon: Flower2, color: 'bg-green-100 text-green-600' },
  { name: 'Cozinheiro', icon: ChefHat, color: 'bg-red-100 text-red-600' },
  { name: 'Mudanças', icon: Truck, color: 'bg-indigo-100 text-indigo-600' },
  { name: 'Babá', icon: Baby, color: 'bg-pink-100 text-pink-600' },
  { name: 'Segurança', icon: Shield, color: 'bg-slate-100 text-slate-600' },
  { name: 'Informática', icon: Monitor, color: 'bg-blue-100 text-blue-600' },
  { name: 'Tutoria', icon: GraduationCap, color: 'bg-orange-100 text-orange-600' },
  { name: 'Design Gráfico', icon: Palette, color: 'bg-pink-100 text-pink-600' },
  { name: 'Consultoria', icon: Presentation, color: 'bg-blue-100 text-blue-600' },
  { name: 'Evento', icon: Calendar, color: 'bg-red-100 text-red-600' },
];

const COUPONS = [
  { code: 'BEMVINDO', discount: 0.15, description: '15% de desconto para novos usuários' },
  { code: 'MATCH20', discount: 0.20, description: '20% de desconto em qualquer serviço' },
  { code: 'LUANDA50', discount: 0.50, description: '50% de desconto (limitado)' },
];

// Job Timer Component
const JobTimer = ({ createdAt }: { createdAt: any }) => {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const calculateElapsed = () => {
      if (!createdAt) return;
      const start = createdAt.seconds ? new Date(createdAt.seconds * 1000) : new Date(createdAt);
      const now = new Date();
      const diff = now.getTime() - start.getTime();

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setElapsed(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setElapsed(`${minutes}m ${seconds}s`);
      } else {
        setElapsed(`${seconds}s`);
      }
    };

    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  return (
    <div className="flex items-center gap-1 text-orange-500 text-[10px] font-black uppercase tracking-widest bg-orange-50 px-2 py-1 rounded-lg">
      <Clock size={10} />
      Aguardando: {elapsed}
    </div>
  );
};

// User Status Indicator Component
const UserStatusIndicator = ({ uid, showText = false, className, textClassName, dotOnly = false }: { uid: string, showText?: boolean, className?: string, textClassName?: string, dotOnly?: boolean }) => {
  const [status, setStatus] = useState<{ isOnline: boolean, lastSeen: any } | null>(null);

  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setStatus({ isOnline: data.isOnline, lastSeen: data.lastSeen });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    });
    return unsubscribe;
  }, [uid]);

  const formatLastSeen = (lastSeen: any) => {
    if (!lastSeen) return 'visto recentemente';
    
    const date = lastSeen.toDate ? lastSeen.toDate() : (lastSeen.seconds ? new Date(lastSeen.seconds * 1000) : new Date(lastSeen));
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days === 1) return 'ontem';
    if (days < 7) return `${days}d`;
    
    return date.toLocaleDateString();
  };

  if (!status) return <div className={cn("w-2 h-2 rounded-full bg-gray-200 animate-pulse", className)} />;

  if (dotOnly) {
    return (
      <div className="relative flex items-center justify-center">
        {status.isOnline && (
          <motion.div
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 rounded-full bg-green-400"
          />
        )}
        <div className={cn(
          "w-2 h-2 rounded-full border border-white shadow-sm transition-colors duration-500 relative z-10",
          status.isOnline ? "bg-green-500 shadow-lg shadow-green-200" : "bg-gray-300",
          className
        )} />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex items-center justify-center">
        {status.isOnline && (
          <motion.div
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 rounded-full bg-green-400"
          />
        )}
        <div className={cn(
          "w-2 h-2 rounded-full border border-white shadow-sm transition-colors duration-500 relative z-10",
          status.isOnline ? "bg-green-500 shadow-lg shadow-green-200" : "bg-gray-300"
        )} />
      </div>
      {showText && (
        <span className={cn("text-[8px] font-black uppercase tracking-widest transition-colors", 
          status.isOnline ? "text-green-600" : "text-gray-400",
          textClassName
        )}>
          {status.isOnline ? 'Online' : `Há ${formatLastSeen(status.lastSeen)}`}
        </span>
      )}
    </div>
  );
};

// Image Optimization Utility
const compressImage = (file: File, maxWidth: number = 400, maxHeight: number = 400, quality: number = 0.7): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas to Blob conversion failed'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [view, setView] = useState<View>('home');
  const [taskTab, setTaskTab] = useState<'active' | 'completed'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<TaskUser | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [proposalPrice, setProposalPrice] = useState('');
  const [proposalError, setProposalError] = useState('');
  const [acceptedPrice, setAcceptedPrice] = useState<number | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any | null>(null);
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [tempPhone, setTempPhone] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [userRole, setUserRole] = useState<'client' | 'provider'>('client');
  const [minRating, setMinRating] = useState(0);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [searchRadius, setSearchRadius] = useState(10); // Default 10km
  const [isRadiusFilterEnabled, setIsRadiusFilterEnabled] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<'list' | 'map'>('list');
  const [providers, setProviders] = useState<TaskUser[]>([]);
  const [providersLimit, setProvidersLimit] = useState(10);
  const [tasksLimit, setTasksLimit] = useState(10);
  const [providerTasksLimit, setProviderTasksLimit] = useState(10);
  const [jobsLimit, setJobsLimit] = useState(10);
  const [chatsLimit, setChatsLimit] = useState(10);
  const [hasMoreProviders, setHasMoreProviders] = useState(true);
  const [hasMoreTasks, setHasMoreTasks] = useState(true);
  const [hasMoreJobs, setHasMoreJobs] = useState(true);
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [providerTasks, setProviderTasks] = useState<Task[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [userChats, setUserChats] = useState<any[]>([]);
  const [offlineMessages, setOfflineMessages] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteProviders, setFavoriteProviders] = useState<TaskUser[]>([]);

  // Toggle Favorite
  const toggleFavorite = async (provider: TaskUser) => {
    if (!user) {
      toast.error('Faça login para favoritar profissionais');
      return;
    }

    const isFavorite = favorites.has(provider.uid);
    const favoriteRef = doc(db, 'users', user.uid, 'favorites', provider.uid);

    try {
      if (isFavorite) {
        await deleteDoc(favoriteRef);
        setFavorites(prev => {
          const next = new Set(prev);
          next.delete(provider.uid);
          return next;
        });
        toast.success(`${provider.name} removido dos favoritos`);
      } else {
        await setDoc(favoriteRef, {
          providerId: provider.uid,
          providerName: provider.name,
          providerPhoto: provider.photoURL || '',
          createdAt: serverTimestamp()
        });
        setFavorites(prev => new Set(prev).add(provider.uid));
        toast.success(`${provider.name} adicionado aos favoritos`);
      }
    } catch (error) {
      console.error('Erro ao favoritar:', error);
      toast.error('Erro ao atualizar favoritos');
    }
  };

  // Fetch Favorites
  useEffect(() => {
    if (!user) {
      setFavorites(new Set());
      setFavoriteProviders([]);
      return;
    }

    const q = query(collection(db, 'users', user.uid, 'favorites'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const favIds = new Set<string>();
      const favs: TaskUser[] = [];
      
      // We need to fetch the full provider data for the favorites view
      // In a real app, you might denormalize or fetch in chunks
      const providerPromises = snapshot.docs.map(async (favDoc) => {
        const data = favDoc.data();
        favIds.add(data.providerId);
        
        // Try to find in current providers list first to avoid extra reads
        const existing = providers.find(p => p.uid === data.providerId);
        if (existing) return existing;
        
        // Otherwise fetch from Firestore
        const pDoc = await getDoc(doc(db, 'users', data.providerId));
        return pDoc.exists() ? { uid: pDoc.id, ...pDoc.data() } as TaskUser : null;
      });

      const results = await Promise.all(providerPromises);
      const finalFavs = results.filter((p): p is TaskUser => p !== null);
      setFavoriteProviders(finalFavs);
      setFavorites(favIds);
      
      if (finalFavs.length > 0) {
        localStorage.setItem('cached_favorites', JSON.stringify(finalFavs));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/favorites`);
    });

    return () => unsubscribe();
  }, [user, providers]);

  // Load offline messages from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('offline_messages');
    if (stored) {
      setOfflineMessages(JSON.parse(stored));
    }
  }, []);
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [isPublishingJob, setIsPublishingJob] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isProfileEditModalOpen, setIsProfileEditModalOpen] = useState(false);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [isEditingSkills, setIsEditingSkills] = useState(false);
  const [selectedPortfolioImage, setSelectedPortfolioImage] = useState<any | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [tempBio, setTempBio] = useState('');
  const [tempSkills, setTempSkills] = useState<string[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [jobCategory, setJobCategory] = useState('');
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [taskToRate, setTaskToRate] = useState<Task | null>(null);
  const [providerReviews, setProviderReviews] = useState<Review[]>([]);
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem('language') as Language) || 'pt';
  });
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'light';
  });

  const t = (key: keyof typeof translations['pt']) => {
    return translations[language][key] || translations['pt'][key] || key;
  };

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  const [myReviews, setMyReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminderLeadTime, setReminderLeadTime] = useState(() => {
    const saved = localStorage.getItem('reminder_lead_time');
    return saved ? parseInt(saved) : 30;
  }); // in minutes
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = React.useRef<any>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // Track online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Push Notifications Setup
  useEffect(() => {
    if (!user) return;

    const setupNotifications = async () => {
      try {
        if (!("Notification" in window)) {
          console.log("Este navegador não suporta notificações.");
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          // Note: In a real app, you'd get the VAPID key from Firebase Console
          const token = await getToken(messaging).catch(err => {
            console.log('Token retrieval failed (likely missing VAPID key):', err);
            return null;
          });
          
          if (token) {
            await setDoc(doc(db, 'users', user.uid), {
              fcmToken: token
            }, { merge: true });
          }
        }
      } catch (error) {
        console.error('Erro ao configurar notificações:', error);
      }
    };

    setupNotifications();

    const unsubscribe = onMessage(messaging, (payload) => {
      toast(payload.notification?.title || 'Nova Notificação', {
        description: payload.notification?.body,
        icon: <Bell size={16} className="text-blue-600" />,
        action: {
          label: 'Ver',
          onClick: () => {
            if (payload.data?.view) {
              setView(payload.data.view as View);
            }
          }
        }
      });
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch providers from Firestore with pagination
  useEffect(() => {
    setLoadingMore(true);
    let q = query(
      collection(db, 'users'), 
      where('role', 'in', ['provider', 'both']),
      limit(providersLimit)
    );

    // If we have a specialty selected, we can filter by it in Firestore
    if (selectedSpecialty) {
      q = query(q, where('skills', 'array-contains', selectedSpecialty));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(doc => ({
        uid: doc.id,
        ...doc.data()
      })) as TaskUser[];
      
      setProviders(users);
      setHasMoreProviders(snapshot.docs.length === providersLimit);
      setLoadingMore(false);
      
      if (users.length > 0) {
        localStorage.setItem('cached_providers', JSON.stringify(users));
      }
    }, (error) => {
      console.error("Firestore error:", error);
      setLoadingMore(false);
      const cached = localStorage.getItem('cached_providers');
      if (cached) {
        setProviders(JSON.parse(cached));
      }
    });
    return unsubscribe;
  }, [providersLimit, selectedSpecialty]);

  // Background task checker for reminders
  useEffect(() => {
    if (!user) return;

    const checkReminders = async () => {
      const now = new Date();
      const myLeadTimeMs = reminderLeadTime * 60 * 1000;
      
      const upcomingTasks = [...tasks, ...providerTasks].filter(task => {
        if (!task.scheduledAt || task.status !== 'accepted') return false;
        
        const isClient = task.clientId === user.uid;
        const isProvider = task.providerId === user.uid;
        
        // Skip if this user already got their reminder
        if (isClient && task.clientReminderSent) return false;
        if (isProvider && task.providerReminderSent) return false;
        
        const scheduledDate = task.scheduledAt.toDate ? task.scheduledAt.toDate() : new Date(task.scheduledAt);
        const timeUntil = scheduledDate.getTime() - now.getTime();
        
        // Notify if within MY lead time, but not if it's already passed by more than 5 mins
        return timeUntil > -300000 && timeUntil <= myLeadTimeMs;
      });

      for (const task of upcomingTasks) {
        const isClient = task.clientId === user.uid;
        const isProvider = task.providerId === user.uid;

        // Mark as sent locally first to avoid double notification in current session
        if (isProvider) {
          setProviderTasks(prev => prev.map(t => t.id === task.id ? { ...t, providerReminderSent: true } : t));
        } else {
          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, clientReminderSent: true } : t));
        }

        const scheduledTimeStr = new Date(task.scheduledAt.toDate ? task.scheduledAt.toDate() : task.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        const title = 'Lembrete de Agendamento';
        const body = `Você tem um serviço "${task.title}" agendado para as ${scheduledTimeStr}.`;

        if (isOnline) {
          // Send In-App Notification to CURRENT user
          await addDoc(collection(db, 'notifications'), {
            userId: user.uid,
            title,
            body,
            type: 'task_reminder',
            taskId: task.id,
            read: false,
            createdAt: serverTimestamp(),
          });

          // Update Firestore task to persist MY reminderSent status
          const updateData: any = {};
          if (isClient) updateData.clientReminderSent = true;
          if (isProvider) updateData.providerReminderSent = true;
          // Also set legacy field for compatibility
          updateData.reminderSent = true;
          
          await updateDoc(doc(db, 'tasks', task.id), updateData);
        }

        // Browser Notification (only for current user)
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body: body,
            icon: '/favicon.ico'
          });
        }

        toast.info(title, {
          description: body,
          icon: <Clock size={16} className="text-blue-600" />
        });
      }
    };

    const interval = setInterval(checkReminders, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [user, tasks, providerTasks, reminderLeadTime, isOnline]);

  // Initial load from cache
  useEffect(() => {
    const cachedProviders = localStorage.getItem('cached_providers');
    if (cachedProviders) setProviders(JSON.parse(cachedProviders));

    const cachedTasks = localStorage.getItem('cached_tasks');
    if (cachedTasks) setTasks(JSON.parse(cachedTasks));

    const cachedProviderTasks = localStorage.getItem('cached_provider_tasks');
    if (cachedProviderTasks) setProviderTasks(JSON.parse(cachedProviderTasks));

    const cachedChats = localStorage.getItem('cached_chats');
    if (cachedChats) setUserChats(JSON.parse(cachedChats));

    const cachedFavorites = localStorage.getItem('cached_favorites');
    if (cachedFavorites) {
      const favs = JSON.parse(cachedFavorites) as TaskUser[];
      setFavoriteProviders(favs);
      setFavorites(new Set(favs.map(f => f.uid)));
    }

    const cachedUnread = localStorage.getItem('cached_unread_notifications');
    if (cachedUnread) setUnreadNotifications(parseInt(cachedUnread));

    const cachedJobs = localStorage.getItem('cached_jobs');
    if (cachedJobs) setJobs(JSON.parse(cachedJobs));

    const cachedMyReviews = localStorage.getItem('cached_my_reviews');
    if (cachedMyReviews) setMyReviews(JSON.parse(cachedMyReviews));

    const cachedLeadTime = localStorage.getItem('reminder_lead_time');
    if (cachedLeadTime) setReminderLeadTime(parseInt(cachedLeadTime));
  }, []);

  // Initialize mock providers in Firestore
  useEffect(() => {
    const initProviders = async () => {
      for (const p of MOCK_PROVIDERS) {
        try {
          const pRef = doc(db, 'users', p.uid);
          const pSnap = await getDoc(pRef);
          if (!pSnap.exists()) {
            await setDoc(pRef, {
              ...p,
              createdAt: serverTimestamp()
            });
          }
        } catch (e) {}
      }
    };
    initProviders();
  }, []);

  // Sync user to Firestore and track online status
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Sync user to Firestore
        const userRef = doc(db, 'users', u.uid);
        const updateStatus = (online: boolean) => {
          setDoc(userRef, {
            uid: u.uid,
            name: u.displayName || 'Usuário',
            email: u.email,
            photoURL: u.photoURL,
            isOnline: online,
            lastSeen: serverTimestamp(),
            createdAt: serverTimestamp()
          }, { merge: true });
        };

        updateStatus(navigator.onLine);

        const handleOnline = () => updateStatus(true);
        const handleOffline = () => updateStatus(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Request browser notification permission
        if (Notification.permission === 'default') {
          Notification.requestPermission();
        }

        return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
          updateStatus(false);
        };
      }
    });
    return unsubscribe;
  }, []);

  // Notification Listener
  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', user.uid),
        where('read', '==', false),
        orderBy('createdAt', 'desc'),
        limit(1)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            // Show in-app toast
            toast(data.title, {
              description: data.body,
              action: {
                label: 'Ver',
                onClick: () => {
                  if (data.type === 'message' || data.type === 'proposal') {
                    setView('chat');
                  } else if (data.type === 'job_offer') {
                    // Logic to show job details
                    toast.info(`Oferta: ${data.title}`, { description: data.body });
                  } else if (data.type === 'task_reminder') {
                    setView('tasks');
                  }
                }
              }
            });

            // Show browser notification if allowed
            if (Notification.permission === 'granted') {
              new Notification(data.title, { body: data.body });
            }
          }
        });
        setUnreadNotifications(snapshot.size);
        localStorage.setItem('cached_unread_notifications', snapshot.size.toString());
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      });

      return unsubscribe;
    }
  }, [user]);

  // Sync selected provider with Firestore
  useEffect(() => {
    if (selectedProvider?.uid) {
      const providerRef = doc(db, 'users', selectedProvider.uid);
      const unsubscribe = onSnapshot(providerRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setSelectedProvider(prev => {
            if (!prev || prev.uid !== snapshot.id) return prev;
            return {
              ...prev,
              ...data
            } as TaskUser;
          });
        }
      });
      return unsubscribe;
    }
  }, [selectedProvider?.uid]);

  // Get User Location
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          // Fallback to Luanda center if permission denied or error
          setUserLocation({ lat: -8.839988, lng: 13.289437 });
        }
      );
    }
  }, []);

  const markNotificationsAsRead = async () => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('read', '==', false)
    );
    
    try {
      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { read: true });
      });
      await batch.commit();
      setUnreadNotifications(0);
    } catch (e) {
      console.error("Error marking notifications as read:", e);
    }
  };

  const applyCoupon = () => {
    const coupon = COUPONS.find(c => c.code.toUpperCase() === couponCode.trim().toUpperCase());
    if (coupon) {
      setAppliedCoupon(coupon);
      toast.success(`Cupom "${coupon.code}" aplicado!`, {
        description: `${(coupon.discount * 100).toFixed(0)}% de desconto.`
      });
    } else {
      toast.error('Cupom inválido ou expirado.');
    }
  };

  const handleScheduleBooking = async () => {
    if (!user || !selectedProvider) return;
    if (!scheduleDate || !scheduleTime || !scheduleTitle) {
      toast.error('Por favor, preencha todos os campos.');
      return;
    }

    const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`);
    const now = new Date();

    if (scheduledAt < now) {
      toast.error('A data e hora do agendamento não podem ser no passado.');
      return;
    }

    const toastId = toast.loading('Agendando serviço...');
    try {
      const taskData = {
        clientId: user.uid,
        clientName: user.displayName || 'Cliente',
        providerId: selectedProvider.uid,
        providerName: selectedProvider.name,
        title: scheduleTitle,
        status: 'pending',
        scheduledAt: scheduledAt,
        createdAt: serverTimestamp(),
      };

      if (!isOnline) {
        const stored = localStorage.getItem('offline_actions');
        const queue = stored ? JSON.parse(stored) : [];
        queue.push({
          type: 'schedule_task',
          taskData
        });
        localStorage.setItem('offline_actions', JSON.stringify(queue));
        toast.success('Agendamento salvo offline!', { id: toastId });
      } else {
        const taskRef = await addDoc(collection(db, 'tasks'), taskData);
        
        // Notify provider
        await addDoc(collection(db, 'notifications'), {
          userId: selectedProvider.uid,
          title: 'Novo Agendamento Solicitado',
          body: `${user.displayName || 'Um cliente'} solicitou um serviço para ${scheduledAt.toLocaleString('pt-BR')}.`,
          type: 'task_reminder',
          taskId: taskRef.id,
          read: false,
          createdAt: serverTimestamp(),
        });

        toast.success('Serviço agendado com sucesso!', { 
          id: toastId,
          icon: <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}><CheckCircle2 className="text-green-600" /></motion.div>,
          description: 'O profissional foi notificado.'
        });
      }

      setIsScheduling(false);
      setScheduleDate('');
      setScheduleTime('');
      setScheduleTitle('');
    } catch (error) {
      console.error('Error scheduling task:', error);
      toast.error('Erro ao agendar serviço.', { id: toastId });
    }
  };

  const handleProfileImageChange = async (e: React.ChangeEvent<HTMLInputElement> | Blob) => {
    let file: File | Blob | undefined;
    if (e instanceof Blob) {
      file = e;
    } else {
      file = (e as React.ChangeEvent<HTMLInputElement>).target.files?.[0];
    }
    
    if (!file || !user) return;

    if (e instanceof Blob === false && !(file as File).type.startsWith('image/')) {
      toast.error('Por favor, selecione uma imagem válida.');
      return;
    }

    setIsUploadingImage(true);
    setUploadProgress(0);
    const toastId = toast.loading('Otimizando e enviando imagem...');

    try {
      // 1. Compress and Resize Image
      const originalSize = file.size;
      const optimizedBlob = await compressImage(file as File, 400, 400, 0.7);
      const optimizedSize = optimizedBlob.size;
      const reduction = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);
      
      console.log(`Image optimized: ${originalSize} -> ${optimizedSize} bytes (${reduction}% reduction)`);
      
      // 2. Upload to Firebase Storage
      const fileRef = storageRef(storage, `profiles/${user.uid}/avatar-${Date.now()}.jpg`);
      const uploadTask = uploadBytesResumable(fileRef, optimizedBlob);

      await new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(progress);
          }, 
          (error) => reject(error), 
          () => resolve(null)
        );
      });

      const downloadURL = await getDownloadURL(fileRef);

      // 3. Update Firebase Auth Profile
      await updateProfile(user, { photoURL: downloadURL });

      // 4. Update Firestore User Document
      await setDoc(doc(db, 'users', user.uid), {
        photoURL: downloadURL
      }, { merge: true });

      // 5. Update Local State
      setUser({ ...user, photoURL: downloadURL } as FirebaseUser);
      if (selectedProvider?.uid === user.uid) {
        setSelectedProvider({ ...selectedProvider, photoURL: downloadURL });
      }

      toast.success('Foto de perfil atualizada com sucesso!', { id: toastId });
      setIsPhotoModalOpen(false);
      stopCamera();
    } catch (error) {
      console.error('Error updating profile image:', error);
      toast.error('Erro ao atualizar foto de perfil.', { id: toastId });
    } finally {
      setIsUploadingImage(false);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 640 } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      toast.error('Não foi possível acessar a câmera.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            handleProfileImageChange(blob);
          }
        }, 'image/jpeg', 0.8);
      }
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (searchQuery.trim()) {
      setView('search');
    }
  };

  const startVoiceSearch = async () => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      toast.error('Seu navegador não suporta busca por voz.');
      return;
    }

    try {
      // Explicitly request microphone permission first
      // This helps trigger the browser's permission prompt more reliably in iframes
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately, we just needed the permission
      stream.getTracks().forEach(track => track.stop());
    } catch (err: any) {
      console.error('Microphone access denied:', err);
      toast.error('Acesso ao microfone negado', {
        description: 'Por favor, permita o acesso ao microfone para usar a busca por voz.'
      });
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      toast.info('Ouvindo...', {
        description: 'Fale agora para pesquisar profissionais',
        duration: 3000
      });
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript && transcript.trim()) {
        setSearchQuery(transcript);
        setIsListening(false);
        toast.success(`Entendido: "${transcript}"`);
        // Automatically trigger search
        setView('search');
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      
      switch(event.error) {
        case 'not-allowed':
          toast.error('Microfone bloqueado', {
            description: 'Por favor, permita o acesso ao microfone nas configurações do navegador.'
          });
          break;
        case 'no-speech':
          toast.error('Nenhum som detectado', {
            description: 'Tente falar mais alto ou verifique seu microfone.'
          });
          break;
        case 'network':
          toast.error('Erro de conexão', {
            description: 'A busca por voz requer uma conexão estável.'
          });
          break;
        default:
          toast.error('Falha na voz', {
            description: 'Ocorreu um erro ao tentar usar a busca por voz.'
          });
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("Recognition start error:", e);
      setIsListening(false);
    }
  };

  const filteredProviders = useMemo(() => {
    let result = providers.filter(p => p.role === 'provider' || p.role === 'both');
    
    // Search query filter
    if (searchQuery) {
      result = result.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.skills?.some(s => s.toLowerCase().includes(searchQuery.toLowerCase())) ||
        p.bio?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Rating filter
    if (minRating > 0) {
      result = result.filter(p => (p.rating || 0) >= minRating);
    }

    // Specialty filter
    if (selectedSpecialty) {
      result = result.filter(p => p.skills?.includes(selectedSpecialty));
    }

    // Availability filter
    if (onlyAvailable) {
      result = result.filter(p => p.isOnline);
    }

    // Location/Radius filter
    if (userLocation && isRadiusFilterEnabled) {
      result = result.filter(p => {
        if (!p.lat || !p.lng) return false;
        const distance = calculateDistance(userLocation.lat, userLocation.lng, p.lat, p.lng);
        return distance <= searchRadius;
      });

      // Sort by distance
      result = [...result].sort((a, b) => {
        const distA = calculateDistance(userLocation.lat, userLocation.lng, a.lat!, a.lng!);
        const distB = calculateDistance(userLocation.lat, userLocation.lng, b.lat!, b.lng!);
        return distA - distB;
      });
    }

    return result;
  }, [searchQuery, minRating, selectedSpecialty, onlyAvailable, providers, userLocation, searchRadius, isRadiusFilterEnabled]);

  const resetFilters = () => {
    setMinRating(0);
    setSelectedSpecialty(null);
    setOnlyAvailable(false);
    setSearchRadius(10);
  };

  // Chat logic
  useEffect(() => {
    if (view === 'chat' && user && selectedProvider) {
      const chatId = [user.uid, selectedProvider.uid].sort().join('_');
      
      // Load from cache first
      const cached = localStorage.getItem(`chat_${chatId}`);
      if (cached) {
        setMessages(JSON.parse(cached));
      }

      const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('createdAt', 'asc'),
        limit(50)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Message[];
        
        // Merge with offline messages for this chat
        const stored = localStorage.getItem('offline_messages');
        const queue = stored ? JSON.parse(stored) : [];
        const chatOfflineMsgs = queue.filter((m: any) => m.chatId === chatId);
        
        const allMsgs = [...msgs, ...chatOfflineMsgs].sort((a: any, b: any) => {
          const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt).getTime();
          const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt).getTime();
          return timeA - timeB;
        });

        setMessages(allMsgs);
        // Update cache with all messages (including offline ones for quick load)
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(allMsgs));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `chats/${chatId}/messages`);
      });

      return unsubscribe;
    }
  }, [view, user, selectedProvider]);

  // Fetch all chats for the user
  useEffect(() => {
    if (user) {
      // Load from cache first
      const cached = localStorage.getItem('cached_chats');
      if (cached) {
        setUserChats(JSON.parse(cached));
      }

      setLoadingMore(true);
      const q = query(
        collection(db, 'chats'),
        where('participants', 'array-contains', user.uid),
        orderBy('lastTimestamp', 'desc'),
        limit(chatsLimit)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const cs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setUserChats(cs);
        setHasMoreChats(snapshot.docs.length === chatsLimit);
        setLoadingMore(false);
        if (cs.length > 0) {
          localStorage.setItem('cached_chats', JSON.stringify(cs));
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'chats');
      });

      return unsubscribe;
    }
  }, [user, chatsLimit]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (view === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, view]);

  // Sync offline messages and actions when back online
  const syncOfflineData = useCallback(async () => {
    if (!isOnline || !user) return;

    // Sync Messages
    const storedMsgs = localStorage.getItem('offline_messages');
    if (storedMsgs) {
      const msgQueue = JSON.parse(storedMsgs);
      if (msgQueue.length > 0) {
        toast.info(`Sincronizando ${msgQueue.length} mensagens offline...`);
        for (const msg of msgQueue) {
          try {
            const { tempId, ...messageData } = msg;
            messageData.createdAt = serverTimestamp();
            const chatId = messageData.chatId;
            await addDoc(collection(db, 'chats', chatId, 'messages'), messageData);
            await setDoc(doc(db, 'chats', chatId), {
              lastMessage: messageData.text,
              lastTimestamp: serverTimestamp(),
            }, { merge: true });
            await addDoc(collection(db, 'notifications'), {
              userId: messageData.recipientId,
              title: messageData.type === 'proposal' ? 'Nova Proposta' : `Mensagem de ${user.displayName || 'Cliente'}`,
              body: messageData.text,
              type: messageData.type === 'proposal' ? 'proposal' : 'message',
              read: false,
              createdAt: serverTimestamp()
            });
          } catch (error) {
            console.error("Error syncing message:", error);
          }
        }
        localStorage.removeItem('offline_messages');
        setOfflineMessages([]);
      }
    }

    // Sync Actions (Proposals, Jobs, Tasks, Ratings, Profile)
    const storedActions = localStorage.getItem('offline_actions');
    if (storedActions) {
      const actionQueue = JSON.parse(storedActions);
      if (actionQueue.length > 0) {
        toast.info(`Sincronizando ${actionQueue.length} ações offline...`);
        for (const act of actionQueue) {
          try {
            if (act.type === 'proposal_action') {
              const messageRef = doc(db, 'chats', act.chatId, 'messages', act.messageId);
              await setDoc(messageRef, { proposalStatus: act.action }, { merge: true });
              
              await addDoc(collection(db, 'notifications'), {
                userId: act.recipientId,
                title: `Proposta ${act.action === 'accepted' ? 'Aceita' : 'Recusada'}`,
                body: `Sua proposta de ${act.price} Kz foi ${act.action === 'accepted' ? 'aceita' : 'recusada'}.`,
                type: 'proposal',
                read: false,
                createdAt: serverTimestamp()
              });

              if (act.action === 'accepted') {
                const isUserClient = userRole === 'client';
                const clientId = isUserClient ? user.uid : act.recipientId;
                const providerId = isUserClient ? act.recipientId : user.uid;
                const providerName = isUserClient ? act.providerName : (user.displayName || 'Profissional');

                if (act.taskId) {
                  await updateDoc(doc(db, 'tasks', act.taskId), {
                    status: 'accepted',
                    price: act.price,
                    updatedAt: serverTimestamp()
                  });
                } else {
                  await addDoc(collection(db, 'tasks'), {
                    clientId,
                    clientName: isUserClient ? (user.displayName || 'Cliente') : 'Cliente',
                    providerId,
                    providerName,
                    title: `Serviço de ${act.skills?.[0] || 'Profissional'}`,
                    status: 'accepted',
                    price: act.price,
                    createdAt: serverTimestamp(),
                  });
                }
              }
            } else if (act.type === 'post_job') {
              const jobRef = await addDoc(collection(db, 'jobs'), {
                ...act.jobData,
                createdAt: serverTimestamp()
              });
              
              // Notify nearby providers via helper
              await notifyProviders(jobRef.id, act.jobData.category, act.jobData.clientName, { lat: act.jobData.lat, lng: act.jobData.lng });
            } else if (act.type === 'complete_task') {
              await setDoc(doc(db, 'tasks', act.taskId), { status: 'completed' }, { merge: true });
              await addDoc(collection(db, 'notifications'), {
                userId: act.providerId,
                title: 'Tarefa Concluída',
                body: `O cliente ${user.displayName || 'Cliente'} marcou a tarefa como concluída.`,
                type: 'task_update',
                taskId: act.taskId,
                read: false,
                createdAt: serverTimestamp()
              });
            } else if (act.type === 'submit_rating') {
              await addDoc(collection(db, 'reviews'), {
                ...act.reviewData,
                createdAt: serverTimestamp()
              });
              await setDoc(doc(db, 'tasks', act.reviewData.taskId), { rated: true }, { merge: true });
              
              // Update provider stats
              const providerRef = doc(db, 'users', act.reviewData.providerId);
              const providerSnap = await getDoc(providerRef);
              if (providerSnap.exists()) {
                const providerData = providerSnap.data();
                const currentRating = providerData.rating || 0;
                const currentCount = providerData.reviewCount || 0;
                const newCount = currentCount + 1;
                const newRating = Number(((currentRating * currentCount + act.reviewData.rating) / newCount).toFixed(1));
                await setDoc(providerRef, { rating: newRating, reviewCount: newCount }, { merge: true });
              }
            } else if (act.type === 'update_profile') {
              await updateDoc(doc(db, 'users', user.uid), act.updates);
            } else if (act.type === 'apply_to_job') {
              const taskData = {
                ...act.taskData,
                createdAt: serverTimestamp()
              };
              const taskRef = await addDoc(collection(db, 'tasks'), taskData);
              await deleteDoc(doc(db, 'jobs', act.jobId));
              
              const chatId = [user.uid, act.taskData.clientId].sort().join('_');
              await setDoc(doc(db, 'chats', chatId), {
                participants: [user.uid, act.taskData.clientId],
                lastMessage: `Olá! Aceitei sua oferta para: ${act.taskData.title}`,
                lastTimestamp: serverTimestamp(),
                providerName: user.displayName || 'Profissional',
                providerPhoto: user.photoURL || '',
                clientName: act.taskData.clientName,
                clientPhoto: '',
              }, { merge: true });

              await addDoc(collection(db, 'chats', chatId, 'messages'), {
                chatId,
                senderId: user.uid,
                text: `Olá! Aceitei sua oferta para: ${act.taskData.title}. Como posso ajudar?`,
                createdAt: serverTimestamp(),
              });

              await addDoc(collection(db, 'notifications'), {
                userId: act.taskData.clientId,
                title: 'Oferta Aceita!',
                body: `${user.displayName || 'Profissional'} aceitou sua oferta de serviço.`,
                type: 'job_accepted',
                taskId: taskRef.id,
                read: false,
                createdAt: serverTimestamp()
              });
            } else if (act.type === 'delete_job') {
              await deleteDoc(doc(db, 'jobs', act.jobId));
            } else if (act.type === 'schedule_task') {
              const taskRef = await addDoc(collection(db, 'tasks'), {
                ...act.taskData,
                createdAt: serverTimestamp()
              });
              
              // Notify provider
              await addDoc(collection(db, 'notifications'), {
                userId: act.taskData.providerId,
                title: 'Novo Agendamento Solicitado',
                body: `${act.taskData.clientName || 'Um cliente'} solicitou um serviço para ${new Date(act.taskData.scheduledAt).toLocaleString('pt-BR')}.`,
                type: 'task_reminder',
                taskId: taskRef.id,
                read: false,
                createdAt: serverTimestamp(),
              });
            }
          } catch (error) {
            console.error("Error syncing action:", error);
          }
        }
        localStorage.removeItem('offline_actions');
        toast.success('Dados sincronizados com sucesso!');
      }
    }
  }, [isOnline, user, userRole]);

  // Sync offline messages and actions when back online
  useEffect(() => {
    if (isOnline && user) {
      syncOfflineData();
    }
  }, [isOnline, user, syncOfflineData]);

  // Background periodic synchronization
  useEffect(() => {
    let interval: any;
    if (isOnline && user) {
      interval = setInterval(() => {
        syncOfflineData();
      }, 30000); // Check every 30 seconds
    }
    return () => clearInterval(interval);
  }, [isOnline, user, syncOfflineData]);

  const sendMessage = async (type: 'text' | 'proposal' = 'text', price?: number) => {
    if (!user || !selectedProvider) return;
    if (type === 'text' && !newMessage.trim()) return;

    const chatId = [user.uid, selectedProvider.uid].sort().join('_');
    const messageData: any = {
      chatId,
      senderId: user.uid,
      recipientId: selectedProvider.uid,
      text: type === 'proposal' ? `Proposta de serviço: ${price} Kz` : newMessage,
      type,
      createdAt: isOnline ? serverTimestamp() : new Date().toISOString(),
    };

    if (type === 'proposal') {
      messageData.price = price;
      messageData.proposalStatus = 'pending';
      if (selectedTask) {
        messageData.taskId = selectedTask.id;
      }
    }

    if (!isOnline) {
      const tempId = `temp_${Date.now()}`;
      const offlineMsg = { ...messageData, id: tempId, tempId, isOffline: true };
      
      // Update local state and cache
      setMessages(prev => {
        const updated = [...prev, offlineMsg];
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(updated));
        return updated;
      });
      
      // Save to queue
      const stored = localStorage.getItem('offline_messages');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push(offlineMsg);
      localStorage.setItem('offline_messages', JSON.stringify(queue));
      setOfflineMessages(queue);

      setNewMessage('');
      setProposalPrice('');
      setIsProposalModalOpen(false);
      toast.info('Mensagem salva offline. Será enviada quando houver conexão.');
      return;
    }

    try {
      // Create/Update the chat document
      const chatRef = doc(db, 'chats', chatId);
      try {
        await setDoc(chatRef, {
          participants: [user.uid, selectedProvider.uid],
          lastMessage: messageData.text,
          lastTimestamp: serverTimestamp(),
          providerName: selectedProvider.name,
          providerPhoto: selectedProvider.photoURL,
          clientName: user.displayName || 'Cliente',
          clientPhoto: user.photoURL || '',
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}`);
        return;
      }

      try {
        await addDoc(collection(db, 'chats', chatId, 'messages'), messageData);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}/messages`);
        return;
      }
      
      try {
        // Create notification for the recipient
        await addDoc(collection(db, 'notifications'), {
          userId: selectedProvider.uid,
          title: type === 'proposal' ? 'Nova Proposta' : `Mensagem de ${user.displayName || 'Cliente'}`,
          body: messageData.text,
          type: type === 'proposal' ? 'proposal' : 'message',
          read: false,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'notifications');
        return;
      }

      setNewMessage('');
      setProposalPrice('');
      setIsProposalModalOpen(false);
      if (type === 'proposal') {
        toast.success('Proposta enviada!', {
          icon: <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}><Sparkles className="text-blue-600" /></motion.div>
        });
      }
    } catch (error) {
      // This catch handles any other errors not caught above
      console.error('General sendMessage error:', error);
    }
  };

  // Fetch Tasks (as client) with pagination
  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'tasks'),
        where('clientId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(tasksLimit)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const tks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setTasks(tks);
        setHasMoreTasks(snapshot.docs.length === tasksLimit);
        if (tks.length > 0) {
          localStorage.setItem('cached_tasks', JSON.stringify(tks));
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'tasks');
      });

      return unsubscribe;
    }
  }, [user, tasksLimit]);

  // Fetch Provider Tasks with pagination
  useEffect(() => {
    if (user && userRole === 'provider') {
      const q = query(
        collection(db, 'tasks'),
        where('providerId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(providerTasksLimit)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const tks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Task[];
        setProviderTasks(tks);
        if (tks.length > 0) {
          localStorage.setItem('cached_provider_tasks', JSON.stringify(tks));
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'tasks');
      });

      return unsubscribe;
    }
  }, [user, userRole, providerTasksLimit]);

  // Fetch My Reviews (as provider)
  useEffect(() => {
    if (user && userRole === 'provider') {
      const q = query(
        collection(db, 'reviews'),
        where('providerId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(20)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const revs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Review[];
        setMyReviews(revs);
        if (revs.length > 0) {
          localStorage.setItem('cached_my_reviews', JSON.stringify(revs));
        }
      }, (error) => {
        console.error("Error fetching my reviews:", error);
        // Fallback to query without orderBy if index is missing
        const fallbackQuery = query(
          collection(db, 'reviews'),
          where('providerId', '==', user.uid),
          limit(20)
        );
        onSnapshot(fallbackQuery, (snapshot) => {
          const revs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Review[];
          // Sort client-side
          revs.sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
          });
          setMyReviews(revs);
        });
      });

      return unsubscribe;
    }
  }, [user, userRole]);

  const completeTask = async (task: Task) => {
    if (!user) return;

    if (!isOnline) {
      const stored = localStorage.getItem('offline_actions');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push({
        type: 'complete_task',
        taskId: task.id,
        providerId: task.providerId,
        clientName: user.displayName || 'Cliente'
      });
      localStorage.setItem('offline_actions', JSON.stringify(queue));
      toast.info('Ação salva offline. Será processada quando houver conexão.');
      
      // Optimistic update
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed' } : t));
      return;
    }

    try {
      await setDoc(doc(db, 'tasks', task.id), { status: 'completed' }, { merge: true });
      
      // Notify the provider about task completion
      await addDoc(collection(db, 'notifications'), {
        userId: task.providerId,
        title: 'Tarefa Concluída',
        body: `O cliente ${user.displayName || 'Cliente'} marcou a tarefa como concluída.`,
        type: 'task_update',
        taskId: task.id,
        read: false,
        createdAt: serverTimestamp()
      });

      toast.success('Tarefa concluída com sucesso!');
      setTaskToRate(task);
      setIsRatingModalOpen(true);
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error('Erro ao concluir tarefa.');
    }
  };

  const submitRating = async () => {
    if (!user || !taskToRate) return;

    const reviewData: any = {
      taskId: taskToRate.id,
      clientId: taskToRate.clientId,
      providerId: taskToRate.providerId,
      clientName: user.displayName || 'Cliente',
      rating: ratingValue,
      comment: ratingComment,
    };

    if (!isOnline) {
      const stored = localStorage.getItem('offline_actions');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push({
        type: 'submit_rating',
        reviewData
      });
      localStorage.setItem('offline_actions', JSON.stringify(queue));
      toast.info('Avaliação salva offline. Será enviada quando houver conexão.');
      
      // Optimistic update for local task state
      setTasks(prev => prev.map(t => t.id === taskToRate.id ? { ...t, rated: true } : t));
      
      setIsRatingModalOpen(false);
      setRatingComment('');
      setRatingValue(5);
      setTaskToRate(null);
      return;
    }

    try {
      reviewData.createdAt = serverTimestamp();
      await addDoc(collection(db, 'reviews'), reviewData);
      await setDoc(doc(db, 'tasks', taskToRate.id), { rated: true }, { merge: true });

      // Update provider stats
      const providerRef = doc(db, 'users', taskToRate.providerId);
      const providerSnap = await getDoc(providerRef);
      if (providerSnap.exists()) {
        const providerData = providerSnap.data();
        const currentRating = providerData.rating || 0;
        const currentCount = providerData.reviewCount || 0;
        const newCount = currentCount + 1;
        const newRating = Number(((currentRating * currentCount + ratingValue) / newCount).toFixed(1));
        
        await setDoc(providerRef, { 
          rating: newRating, 
          reviewCount: newCount 
        }, { merge: true });

        // Update local state if viewing this provider
        if (selectedProvider && selectedProvider.uid === taskToRate.providerId) {
          setSelectedProvider({
            ...selectedProvider,
            rating: newRating,
            reviewCount: newCount
          });
        }
      }

      toast.success('Avaliação enviada! Obrigado.');
      setIsRatingModalOpen(false);
      setRatingComment('');
      setRatingValue(5);
      setTaskToRate(null);
    } catch (error) {
      console.error('Error submitting rating:', error);
      toast.error('Erro ao enviar avaliação.');
    }
  };

  const publishJob = async () => {
    if (!user) {
      toast.error('Você precisa estar logado para publicar uma oferta.');
      return;
    }

    if (!jobTitle.trim() || !jobDescription.trim() || !jobCategory) {
      toast.error('Por favor, preencha todos os campos.');
      return;
    }

    setIsPublishingJob(true);
    try {
      const jobData: any = {
        clientId: user.uid,
        clientName: user.displayName || 'Cliente',
        title: jobTitle,
        description: jobDescription,
        category: jobCategory,
        lat: userLocation?.lat || -8.839988, // Default to Luanda if no location
        lng: userLocation?.lng || 13.289437,
        createdAt: serverTimestamp(),
      };

      const jobRef = await addDoc(collection(db, 'jobs'), jobData);
      
      // Notify nearby providers
      try {
        await notifyProviders(jobRef.id, jobCategory, user.displayName || 'Cliente', { lat: jobData.lat, lng: jobData.lng });
      } catch (notifErr) {
        console.warn('Error notifying providers:', notifErr);
      }
      
      toast.success('Oferta publicada com sucesso!');
      setIsJobModalOpen(false);
      setJobTitle('');
      setJobDescription('');
      setJobCategory('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'jobs');
    } finally {
      setIsPublishingJob(false);
    }
  };

  // Fetch Reviews for selected provider
  useEffect(() => {
    if (view === 'profile' && selectedProvider) {
      const q = query(
        collection(db, 'reviews'),
        where('providerId', '==', selectedProvider.uid),
        orderBy('createdAt', 'desc'),
        limit(10)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const revs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Review[];
        setProviderReviews(revs);
      }, (error) => {
        console.error("Error fetching provider reviews:", error);
        // Fallback to query without orderBy if index is missing
        const fallbackQuery = query(
          collection(db, 'reviews'),
          where('providerId', '==', selectedProvider.uid),
          limit(10)
        );
        onSnapshot(fallbackQuery, (snapshot) => {
          const revs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Review[];
          // Sort client-side
          revs.sort((a, b) => {
            const timeA = a.createdAt?.seconds || 0;
            const timeB = b.createdAt?.seconds || 0;
            return timeB - timeA;
          });
          setProviderReviews(revs);
        });
      });

      return unsubscribe;
    }
  }, [view, selectedProvider]);

  // Fetch Jobs for providers with pagination
  useEffect(() => {
    if (user) {
      const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'), limit(jobsLimit));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const jbs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Job[];
        setJobs(jbs);
        setHasMoreJobs(snapshot.docs.length === jobsLimit);
        if (jbs.length > 0) {
          localStorage.setItem('cached_jobs', JSON.stringify(jbs));
        }
      });
      return unsubscribe;
    }
  }, [user, jobsLimit]);

  const postJob = async () => {
    if (!user || !userLocation || !jobTitle || !jobCategory) {
      toast.error('Preencha todos os campos e permita a localização.');
      return;
    }

    const jobData = {
      clientId: user.uid,
      clientName: user.displayName || 'Cliente',
      title: jobTitle,
      description: jobDescription,
      category: jobCategory,
      lat: userLocation.lat,
      lng: userLocation.lng,
    };

    if (!isOnline) {
      const stored = localStorage.getItem('offline_actions');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push({
        type: 'post_job',
        jobData
      });
      localStorage.setItem('offline_actions', JSON.stringify(queue));
      toast.info('Oferta salva offline. Será publicada quando houver conexão.');
      
      setIsJobModalOpen(false);
      setJobTitle('');
      setJobDescription('');
      setJobCategory('');
      setView('tasks');
      return;
    }

    try {
      const jobRef = await addDoc(collection(db, 'jobs'), {
        ...jobData,
        createdAt: serverTimestamp()
      });
      toast.success('Oferta de serviço publicada!', {
        icon: <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}><Sparkles className="text-blue-600" /></motion.div>,
        description: 'Profissionais próximos serão notificados.'
      });
      setIsJobModalOpen(false);
      setJobTitle('');
      setJobDescription('');
      setJobCategory('');
      setView('tasks'); // Go to tasks to see the pending job

      // Notify nearby providers via helper
      await notifyProviders(jobRef.id, jobCategory, user.displayName || 'Cliente', userLocation);
    } catch (error) {
      console.error('Error posting job:', error);
      toast.error('Erro ao publicar oferta.');
    }
  };

  const applyToJob = async (job: Job) => {
    if (!user) return;
    
    const taskData = {
      clientId: job.clientId,
      clientName: job.clientName,
      providerId: user.uid,
      providerName: user.displayName || 'Profissional',
      title: job.title,
      status: 'accepted', // Instantly accepted for Uber feel
    };

    if (!isOnline) {
      const stored = localStorage.getItem('offline_actions');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push({
        type: 'apply_to_job',
        jobId: job.id,
        taskData
      });
      localStorage.setItem('offline_actions', JSON.stringify(queue));
      toast.info('Ação salva offline. Será processada quando houver conexão.');
      
      // Optimistic update
      setJobs(prev => prev.filter(j => j.id !== job.id));
      setView('chat');
      return;
    }

    try {
      const taskRef = await addDoc(collection(db, 'tasks'), {
        ...taskData,
        createdAt: serverTimestamp()
      });
      
      // Delete the job offer as it's taken
      await deleteDoc(doc(db, 'jobs', job.id));

      // Create a chat automatically
      const chatId = [user.uid, job.clientId].sort().join('_');
      const chatRef = doc(db, 'chats', chatId);
      await setDoc(chatRef, {
        participants: [user.uid, job.clientId],
        lastMessage: `Olá! Aceitei sua oferta para: ${job.title}`,
        lastTimestamp: serverTimestamp(),
        providerName: user.displayName || 'Profissional',
        providerPhoto: user.photoURL || '',
        clientName: job.clientName,
        clientPhoto: '', // We don't have client photo in job object, but it's fine for demo
      }, { merge: true });

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        chatId,
        senderId: user.uid,
        text: `Olá! Aceitei sua oferta para: ${job.title}. Como posso ajudar?`,
        createdAt: serverTimestamp(),
      });

      // Notify the client about job acceptance
      await addDoc(collection(db, 'notifications'), {
        userId: job.clientId,
        title: 'Oferta Aceita',
        body: `${user.displayName || 'Um profissional'} aceitou sua oferta para: ${job.title}`,
        type: 'job_offer',
        read: false,
        createdAt: serverTimestamp()
      });

      toast.success('Oferta aceita! Você já pode conversar com o cliente.');
      
      // Mock a provider object for the client so the UI works
      const clientAsProvider = {
        uid: job.clientId,
        name: job.clientName,
        photoURL: 'https://picsum.photos/seed/client/200/200',
        role: 'client'
      } as any;

      setSelectedProvider(clientAsProvider);
      setSelectedTask({ id: taskRef.id, ...taskData } as Task);
      setView('chat');
    } catch (error) {
      console.error("Error applying to job:", error);
      toast.error('Erro ao aceitar oferta.');
    }
  };

  const handleProposalAction = async (message: Message, action: 'accepted' | 'rejected') => {
    if (!user || !selectedProvider) return;

    if (!isOnline) {
      const stored = localStorage.getItem('offline_actions');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push({
        type: 'proposal_action',
        messageId: message.id,
        chatId: [user.uid, selectedProvider.uid].sort().join('_'),
        action,
        senderId: user.uid,
        recipientId: message.senderId,
        price: message.price,
        providerName: selectedProvider.name,
        skills: selectedProvider.skills,
        taskId: message.taskId
      });
      localStorage.setItem('offline_actions', JSON.stringify(queue));
      toast.info('Ação salva offline. Será processada quando houver conexão.');
      
      // Optimistic update for local UI and cache
      setMessages(prev => {
        const updated = prev.map(m => m.id === message.id ? { ...m, proposalStatus: action } : m);
        localStorage.setItem(`chat_${chatId}`, JSON.stringify(updated));
        return updated;
      });
      return;
    }

    const chatId = [user.uid, selectedProvider.uid].sort().join('_');
    const messageRef = doc(db, 'chats', chatId, 'messages', message.id);

    try {
      await setDoc(messageRef, { proposalStatus: action }, { merge: true });
      
      // Notify the other user about the proposal update
      await addDoc(collection(db, 'notifications'), {
        userId: message.senderId,
        title: `Proposta ${action === 'accepted' ? 'Aceita' : 'Recusada'}`,
        body: `Sua proposta de ${message.price} Kz foi ${action === 'accepted' ? 'aceita' : 'recusada'}.`,
        type: 'proposal',
        read: false,
        createdAt: serverTimestamp()
      });

      // Also send a text message to the chat to log the action
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        chatId,
        senderId: user.uid,
        recipientId: message.senderId,
        text: `Proposta de ${message.price?.toLocaleString()} Kz ${action === 'accepted' ? 'aceita' : 'recusada'}.`,
        type: 'text',
        createdAt: serverTimestamp(),
      });

      if (action === 'accepted') {
        setAcceptedPrice(message.price || null);
        
        const isUserClient = userRole === 'client';
        const clientId = isUserClient ? user.uid : selectedProvider.uid;
        const clientName = isUserClient ? (user.displayName || 'Cliente') : selectedProvider.name;
        const providerId = isUserClient ? selectedProvider.uid : user.uid;
        const providerName = isUserClient ? selectedProvider.name : (user.displayName || 'Profissional');

        if (message.taskId) {
          // Update existing task
          await updateDoc(doc(db, 'tasks', message.taskId), {
            status: 'accepted',
            price: message.price,
            updatedAt: serverTimestamp()
          });
          toast.success('Tarefa atualizada com o novo preço!');
        } else {
          // Create a new task
          const taskRef = await addDoc(collection(db, 'tasks'), {
            clientId,
            clientName,
            providerId,
            providerName,
            title: `Serviço de ${selectedProvider.skills?.[0] || 'Profissional'}`,
            status: 'accepted',
            price: message.price,
            createdAt: serverTimestamp(),
          });

          // Create a reminder notification for the client
          await addDoc(collection(db, 'notifications'), {
            userId: clientId,
            title: 'Lembrete de Tarefa',
            body: `Você tem um serviço agendado com ${providerName} em breve.`,
            type: 'task_reminder',
            taskId: taskRef.id,
            read: false,
            createdAt: serverTimestamp()
          });
          toast.success('Nova tarefa criada com sucesso!');
        }

        setView('payment');
      } else {
        toast.error('Proposta recusada.');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}/messages/${message.id}`);
    }
  };

  const handleContact = (type: 'call' | 'whatsapp') => {
    if (!selectedProvider) return;
    
    if (selectedProvider.phone) {
      const cleanPhone = selectedProvider.phone.replace(/\D/g, '');
      if (type === 'call') {
        window.location.href = `tel:${cleanPhone}`;
      } else {
        window.open(`https://wa.me/${cleanPhone}`, '_blank');
      }
    } else {
      setView('chat');
      toast.info('Telefone não disponível. Iniciando chat direto...');
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    
    const updates: any = {};
    if (isEditingBio) updates.bio = tempBio;
    if (isEditingSkills) updates.skills = tempSkills;
    if (isEditingPhone) updates.phone = tempPhone;

    if (!isOnline) {
      const stored = localStorage.getItem('offline_actions');
      const queue = stored ? JSON.parse(stored) : [];
      queue.push({
        type: 'update_profile',
        updates
      });
      localStorage.setItem('offline_actions', JSON.stringify(queue));
      toast.info('Alterações salvas offline. Serão sincronizadas quando houver conexão.');
      
      // Update local state
      if (selectedProvider && selectedProvider.uid === user.uid) {
        setSelectedProvider({ ...selectedProvider, ...updates });
      }
      setIsEditingBio(false);
      setIsEditingSkills(false);
      setIsEditingPhone(false);
      return;
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, updates);
      
      // Update local state if viewing own profile
      if (selectedProvider && selectedProvider.uid === user.uid) {
        setSelectedProvider({
          ...selectedProvider,
          ...updates
        });
      }
      
      setIsEditingBio(false);
      setIsEditingSkills(false);
      setIsEditingPhone(false);
      toast.success('Perfil atualizado com sucesso!', {
        icon: <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}><CheckCircle2 className="text-green-600" /></motion.div>
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Erro ao atualizar perfil.');
    }
  };

  const formatLastSeen = (lastSeen: any) => {
    if (!lastSeen) return 'Visto por último recentemente';
    
    const date = lastSeen.seconds ? new Date(lastSeen.seconds * 1000) : new Date(lastSeen);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'Visto agora mesmo';
    if (minutes < 60) return `Visto há ${minutes} min`;
    if (hours < 24) return `Visto há ${hours}h`;
    if (days === 1) return 'Visto ontem';
    if (days < 7) return `Visto há ${days} dias`;
    
    return `Visto em ${date.toLocaleDateString()}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-300 font-sans selection:bg-blue-100 dark:selection:bg-blue-900",
      theme === 'dark' ? "dark bg-[#0a0a0a] text-white" : "bg-gray-50 text-gray-900"
    )}>
      <Toaster position="top-center" richColors />
      
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-white px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-center flex items-center justify-center gap-2 sticky top-0 z-[60]">
          <WifiOff size={12} />
          Modo Offline: Usando dados em cache
        </div>
      )}

      <AnimatePresence>
        {!isOnline && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-orange-500 text-white text-[10px] font-black uppercase tracking-widest py-1.5 flex items-center justify-center gap-2 sticky top-0 z-[60]"
          >
            <WifiOff size={12} />
            Modo Offline: Usando dados em cache
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-black/80 backdrop-blur-md border-b border-gray-100 dark:border-white/10 px-4 py-3 flex items-center justify-between transition-colors">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200 dark:shadow-none">
            <Briefcase size={22} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">MatchTask</h1>
          {!isOnline && (
            <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded-full">
              <WifiOff size={8} />
              Offline
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setUnreadNotifications(0)}
            className="relative p-2 text-gray-400 hover:text-blue-600 transition-colors"
          >
            <Bell size={22} />
            {unreadNotifications > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-[#0a0a0a]">
                {unreadNotifications}
              </span>
            )}
          </button>
          {user ? (
            <button 
              onClick={() => setIsMenuOpen(true)}
              className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-100 dark:border-white/10 hover:border-blue-400 transition-colors"
            >
              <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </button>
          ) : (
            <button 
              onClick={handleLogin}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
            >
              Entrar
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto pb-24">
        <AnimatePresence mode="wait">
          {view === 'favorites' && (
            <motion.div 
              key="favorites"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button onClick={() => setView('home')} className="p-2 hover:bg-gray-100 rounded-full">
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Meus Favoritos</h2>
              </div>

              {favoriteProviders.length > 0 ? (
                <div className="space-y-4">
                  {favoriteProviders.map((provider) => (
                    <motion.div 
                      key={provider.uid}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      whileHover={{ y: -2 }}
                      onClick={() => {
                        setSelectedProvider(provider);
                        setView('profile');
                      }}
                      className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex gap-4"
                    >
                      <div className="relative">
                        <img src={provider.photoURL} alt={provider.name} className="w-16 h-16 rounded-xl object-cover" referrerPolicy="no-referrer" />
                        <UserStatusIndicator 
                          uid={provider.uid} 
                          className="absolute -top-1 -right-1 w-3 h-3 border-2" 
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-gray-900">{provider.name}</h3>
                            <UserStatusIndicator uid={provider.uid} showText textClassName="text-[8px]" />
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(provider);
                            }}
                            className="p-2 rounded-full bg-red-50 text-red-500"
                          >
                            <Heart size={16} fill="currentColor" />
                          </motion.button>
                        </div>
                        <div className="flex items-center gap-2 text-yellow-500 mb-1">
                          <Star size={12} fill="currentColor" />
                          <span className="text-xs font-bold">{provider.rating}</span>
                          <span className="text-[10px] text-gray-400 font-medium">({provider.reviewCount} avaliações)</span>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-1">{provider.bio}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
                    <Heart size={40} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Nenhum favorito ainda</h3>
                    <p className="text-sm text-gray-500 max-w-[200px] mx-auto">Favorite profissionais para encontrá-los rapidamente aqui.</p>
                  </div>
                  <button 
                    onClick={() => setView('home')}
                    className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm"
                  >
                    Explorar Profissionais
                  </button>
                </div>
              )}
            </motion.div>
          )}
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 space-y-8"
            >
              {/* Hero Section */}
              <div className="space-y-2 mt-4">
                <h2 className="text-3xl font-extrabold text-gray-900 leading-tight">
                  Trabalho imediato,<br />
                  <span className="text-blue-600">perto de você.</span>
                </h2>
                <p className="text-gray-500 font-medium">Encontre profissionais qualificados em minutos.</p>
              </div>

              {/* Search Bar */}
              <form onSubmit={handleSearch} className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                  <Search size={20} />
                </div>
                <input 
                  type="text" 
                  placeholder={isOnline ? "Preciso de um pintor..." : "Modo Offline - Buscando no cache..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    "w-full pl-12 pr-28 py-4 bg-white border rounded-2xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-lg",
                    isOnline ? "border-gray-200" : "border-orange-200 bg-orange-50/30"
                  )}
                />
                <div className="absolute right-2 top-2 bottom-2 flex items-center gap-1">
                  <button 
                    type="button"
                    onClick={startVoiceSearch}
                    className={cn(
                      "p-3 rounded-xl transition-all",
                      isListening 
                        ? "bg-red-100 text-red-600 animate-pulse shadow-lg shadow-red-100" 
                        : "text-gray-400 hover:bg-gray-100"
                    )}
                  >
                    <Mic size={20} />
                  </button>
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(37, 99, 235, 0.3)" }}
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                  >
                    Buscar
                  </motion.button>
                </div>
              </form>

              {/* Categories */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900">Categorias Populares</h3>
                    <Sparkles size={16} className="text-blue-500" />
                  </div>
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsJobModalOpen(true)}
                    className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:underline"
                  >
                    <Plus size={14} />
                    Publicar Oferta
                  </motion.button>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {CATEGORIES.map((cat) => (
                      <button 
                        key={cat.name}
                        onClick={() => {
                          setSelectedSpecialty(cat.name);
                          setSearchQuery(''); // Clear search query to prioritize specialty
                          setView('search');
                        }}
                        className="flex flex-col items-center gap-2 p-4 bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 hover:border-blue-200 dark:hover:border-blue-500/30 hover:shadow-md transition-all group"
                      >
                        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform", cat.color)}>
                          <cat.icon size={24} />
                        </div>
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{cat.name}</span>
                      </button>
                  ))}
                </div>
              </div>

              {/* Recent Activity / Trust Banner */}
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-600 shadow-sm">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h4 className="font-bold text-blue-900">Pagamento Seguro</h4>
                  <p className="text-xs text-blue-700 font-medium">Pague apenas após o serviço ser concluído e avaliado.</p>
                </div>
              </div>

              {/* Recommended Providers */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900 dark:text-white">Profissionais Recomendados</h3>
                  <button 
                    onClick={() => setView('search')}
                    className="text-xs text-blue-600 font-bold hover:underline"
                  >
                    Ver Todos
                  </button>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4">
                  {providers.length === 0 ? (
                    [...Array(5)].map((_, i) => (
                      <div key={i} className="flex-shrink-0 w-40 h-48 bg-gray-100 dark:bg-white/5 animate-pulse rounded-3xl" />
                    ))
                  ) : (
                    providers.slice(0, 5).map((provider, index) => (
                      <motion.div 
                        key={provider.uid}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        onClick={() => {
                          setSelectedProvider(provider);
                          setView('profile');
                        }}
                        className="flex-shrink-0 w-40 bg-white dark:bg-white/5 p-4 rounded-3xl border border-gray-100 dark:border-white/10 shadow-sm space-y-3 hover:border-blue-200 dark:hover:border-blue-500/30 transition-all cursor-pointer"
                      >
                      <div className="relative mx-auto">
                        <img src={provider.photoURL} alt={provider.name} className="w-20 h-20 rounded-2xl object-cover" referrerPolicy="no-referrer" />
                        <UserStatusIndicator uid={provider.uid} className="absolute -top-1 -right-1 w-4 h-4 border-2 border-white dark:border-[#0a0a0a]" />
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          animate={{ scale: favorites.has(provider.uid) ? [1, 1.2, 1] : 1 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(provider);
                          }}
                          className={cn(
                            "absolute -bottom-1 -right-1 p-1.5 rounded-full shadow-lg border border-white dark:border-[#1a1a1a] transition-all",
                            favorites.has(provider.uid) ? "bg-red-500 text-white" : "bg-white dark:bg-gray-800 text-gray-400"
                          )}
                        >
                          <Heart size={12} fill={favorites.has(provider.uid) ? "currentColor" : "none"} />
                        </motion.button>
                      </div>
                      <div className="text-center space-y-1 mt-1">
                        <div className="flex items-center justify-center gap-1 overflow-hidden">
                          <p className="font-bold text-gray-900 dark:text-white text-sm truncate">{provider.name}</p>
                          <UserStatusIndicator uid={provider.uid} dotOnly />
                        </div>
                        <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest truncate">{provider.skills?.[0] || 'Profissional'}</p>
                        <div className="flex items-center justify-center gap-1 text-yellow-500">
                          <Star size={10} fill="currentColor" />
                          <span className="text-[10px] font-black text-gray-900 dark:text-gray-300">{provider.rating || '5.0'}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
              </div>
            </motion.div>
          )}

          {/* Floating Save Button for Profile Edits */}
          <AnimatePresence>
            {(isEditingBio || isEditingSkills) && view === 'profile' && (
              <motion.div 
                initial={{ opacity: 0, y: 100 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 100 }}
                className="fixed bottom-6 left-4 right-4 z-50"
              >
                <button 
                  onClick={handleSaveProfile}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg uppercase tracking-widest shadow-2xl shadow-blue-300 flex items-center justify-center gap-3 hover:bg-blue-700 transition-all active:scale-95"
                >
                  <Save size={24} />
                  Salvar Alterações do Perfil
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {view === 'search' && (
            <motion.div 
              key="search"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-4"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <button onClick={() => setView('home')} className="p-2 hover:bg-gray-50 rounded-full transition-colors">
                    <ArrowLeft size={24} />
                  </button>
                  <h2 className="text-xl font-bold">Procurar</h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
                    <button 
                      onClick={() => setSearchMode('list')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                        searchMode === 'list' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      Lista
                    </button>
                    <button 
                      onClick={() => setSearchMode('map')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                        searchMode === 'map' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      Mapa
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsFilterModalOpen(true)}
                    className={cn(
                      "p-2 rounded-xl border transition-all relative",
                      (minRating > 0 || selectedSpecialty || onlyAvailable || searchRadius !== 10) 
                        ? "bg-blue-50 border-blue-200 text-blue-600" 
                        : "bg-white border-gray-100 text-gray-400"
                    )}
                  >
                    <Filter size={20} />
                    {(minRating > 0 || selectedSpecialty || onlyAvailable || searchRadius !== 10) && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white" />
                    )}
                  </button>
                </div>
              </div>

              {/* Compact Search Bar in Search View */}
              <form onSubmit={handleSearch} className="relative group mb-6">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                  <Search size={18} />
                </div>
                <input 
                  type="text" 
                  placeholder="Nova busca..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-24 py-3 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base font-bold"
                />
                <div className="absolute right-1 top-1 bottom-1 flex items-center gap-1">
                  <button 
                    type="button" 
                    onClick={startVoiceSearch}
                    className={cn("p-2 rounded-lg transition-all", isListening ? "bg-red-100 text-red-600 animate-pulse" : "text-gray-400 hover:bg-gray-100")}
                  >
                    <Mic size={18} />
                  </button>
                  <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-[10px] shadow-lg shadow-blue-100">OK</button>
                </div>
              </form>

              {/* Quick Filters */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                <button 
                  onClick={() => setOnlyAvailable(!onlyAvailable)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border",
                    onlyAvailable 
                      ? "bg-green-500 border-green-500 text-white shadow-sm" 
                      : "bg-white border-gray-100 text-gray-600"
                  )}
                >
                  <div className={cn("w-1.5 h-1.5 rounded-full", onlyAvailable ? "bg-white" : "bg-green-500")} />
                  Online Agora
                </button>

                <button 
                  onClick={() => setIsFilterModalOpen(true)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border",
                    searchRadius !== 10 
                      ? "bg-blue-600 border-blue-600 text-white shadow-sm" 
                      : "bg-white border-gray-100 text-gray-600"
                  )}
                >
                  <MapPin size={12} />
                  Raio: {searchRadius}km
                </button>

                {minRating > 0 && (
                  <button 
                    onClick={() => setMinRating(0)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-xs font-bold whitespace-nowrap transition-all"
                  >
                    <Star size={12} fill="currentColor" />
                    {minRating}+ Estrelas
                    <X size={12} />
                  </button>
                )}

                {selectedSpecialty && (
                  <button 
                    onClick={() => setSelectedSpecialty(null)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-xs font-bold whitespace-nowrap transition-all"
                  >
                    {selectedSpecialty}
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Specialty Category Bar */}
              <div className="flex items-center gap-3 overflow-x-auto pb-2 no-scrollbar">
                {CATEGORIES.map((cat) => (
                  <button 
                    key={cat.name}
                    onClick={() => setSelectedSpecialty(selectedSpecialty === cat.name ? null : cat.name)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 min-w-[70px] transition-all",
                      selectedSpecialty === cat.name ? "scale-105" : "opacity-60 grayscale-[0.5] hover:opacity-100 hover:grayscale-0"
                    )}
                  >
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm border transition-all",
                      selectedSpecialty === cat.name 
                        ? "bg-blue-600 border-blue-600 text-white shadow-blue-100" 
                        : "bg-white border-gray-100 text-gray-600"
                    )}>
                      <cat.icon size={20} />
                    </div>
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-tighter",
                      selectedSpecialty === cat.name ? "text-blue-600" : "text-gray-400"
                    )}>
                      {cat.name}
                    </span>
                  </button>
                ))}
              </div>

              {searchMode === 'map' ? (
                <div className="h-[500px] rounded-3xl overflow-hidden border border-gray-100 shadow-inner relative z-0">
                  {!isOnline && (
                    <div className="absolute inset-0 bg-gray-100/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-center p-6">
                      <WifiOff size={48} className="text-gray-400 mb-4" />
                      <h3 className="font-bold text-gray-900">Mapa Indisponível Offline</h3>
                      <p className="text-sm text-gray-500">Mude para a visualização em lista para ver os profissionais em cache.</p>
                      <button 
                        onClick={() => setSearchMode('list')}
                        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm"
                      >
                        Ver Lista
                      </button>
                    </div>
                  )}
                  <MapContainer 
                    center={userLocation ? [userLocation.lat, userLocation.lng] : [-8.839988, 13.289437]} 
                    zoom={12} 
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    />
                    <MapClickHandler onLocationSelect={(lat, lng) => {
                      setUserLocation({ lat, lng });
                      setIsRadiusFilterEnabled(true);
                      toast.info('Localização de busca atualizada!');
                    }} />
                    <MapCenterTracker onCenterChange={(lat, lng) => setMapCenter({ lat, lng })} />
                    {userLocation && isRadiusFilterEnabled && (
                      <>
                        <Marker position={[userLocation.lat, userLocation.lng]}>
                          <Popup>Centro de Busca</Popup>
                        </Marker>
                        <Circle 
                          center={[userLocation.lat, userLocation.lng]}
                          radius={searchRadius * 1000}
                          pathOptions={{ 
                            fillColor: '#3b82f6', 
                            fillOpacity: 0.1, 
                            color: '#3b82f6', 
                            weight: 1,
                            dashArray: '5, 10'
                          }}
                        />
                      </>
                    )}
                    {filteredProviders.map(provider => (
                      provider.lat && provider.lng && (
                        <Marker key={provider.uid} position={[provider.lat, provider.lng]}>
                          <Popup>
                            <div className="p-2 min-w-[150px] font-sans">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="relative">
                                  <img src={provider.photoURL} className="w-8 h-8 rounded-full object-cover" />
                                  <UserStatusIndicator uid={provider.uid} className="absolute -top-0.5 -right-0.5 w-2 h-2 border" dotOnly />
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1">
                                    <span className="font-bold text-sm text-gray-900">{provider.name}</span>
                                    <UserStatusIndicator uid={provider.uid} dotOnly />
                                  </div>
                                  {userLocation && provider.lat && provider.lng && (
                                    <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest">
                                      {calculateDistance(userLocation.lat, userLocation.lng, provider.lat, provider.lng).toFixed(1)} km de distância
                                    </span>
                                  )}
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Star size={8} fill="currentColor" className="text-yellow-500" />
                                    <span className="text-[8px] font-bold text-gray-700">{provider.rating?.toFixed(1) || '0.0'}</span>
                                    <span className="text-[8px] text-gray-400 font-medium">({provider.reviewCount || 0})</span>
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(provider);
                                  }}
                                  className={cn(
                                    "ml-auto p-1.5 rounded-full transition-colors",
                                    favorites.has(provider.uid) ? "text-red-500" : "text-gray-300 hover:text-red-500"
                                  )}
                                >
                                  <Heart size={14} fill={favorites.has(provider.uid) ? "currentColor" : "none"} />
                                </button>
                              </div>
                              <p className="text-[10px] text-gray-500 mb-2 line-clamp-2 leading-tight">{provider.bio}</p>
                              
                              {provider.portfolio && provider.portfolio.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Destaque do Portfólio</p>
                                  <div className="relative group/portfolio aspect-video rounded-lg overflow-hidden bg-gray-100">
                                    <img 
                                      src={provider.portfolio[0].imageURL} 
                                      alt={provider.portfolio[0].title}
                                      className="w-full h-full object-cover transition-transform duration-500 group-hover/portfolio:scale-110"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-2 opacity-0 group-hover/portfolio:opacity-100 transition-opacity">
                                      <p className="text-[8px] text-white font-bold truncate">{provider.portfolio[0].title}</p>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <button 
                                onClick={() => {
                                  setSelectedProvider(provider);
                                  setView('profile');
                                }}
                                className="w-full py-2 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                Ver Perfil
                              </button>
                            </div>
                          </Popup>
                        </Marker>
                      )
                    ))}
                  </MapContainer>

                  {/* Map Controls Overlay */}
                  <div className="absolute top-4 right-4 flex flex-col gap-2 z-[1000]">
                    <button 
                      onClick={() => {
                        if ("geolocation" in navigator) {
                          navigator.geolocation.getCurrentPosition(
                            (position) => {
                              setUserLocation({
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                              });
                              setIsRadiusFilterEnabled(true);
                              toast.success('Localização atualizada!');
                            },
                            () => toast.error('Erro ao obter localização.')
                          );
                        }
                      }}
                      className="p-3 bg-white rounded-2xl shadow-lg text-blue-600 hover:bg-gray-50 transition-colors"
                      title="Minha Localização"
                    >
                      <MapPin size={20} />
                    </button>
                    
                    <button 
                      onClick={() => setIsRadiusFilterEnabled(!isRadiusFilterEnabled)}
                      className={cn(
                        "p-3 rounded-2xl shadow-lg transition-colors",
                        isRadiusFilterEnabled ? "bg-blue-600 text-white" : "bg-white text-gray-400"
                      )}
                      title={isRadiusFilterEnabled ? "Desativar Filtro de Raio" : "Ativar Filtro de Raio"}
                    >
                      <Navigation size={20} />
                    </button>
                  </div>

                  {/* Search in this area button */}
                  {mapCenter && (!userLocation || calculateDistance(mapCenter.lat, mapCenter.lng, userLocation.lat, userLocation.lng) > 0.5) && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]">
                      <button 
                        onClick={() => {
                          setUserLocation(mapCenter);
                          setIsRadiusFilterEnabled(true);
                          toast.success('Buscando nesta área');
                        }}
                        className="px-4 py-2 bg-white/90 backdrop-blur-md border border-gray-100 rounded-full shadow-lg text-xs font-black text-blue-600 uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2"
                      >
                        <Search size={14} />
                        Buscar nesta área
                      </button>
                    </div>
                  )}

                  <div className="absolute bottom-6 left-6 right-6 z-[1000]">
                    <div className={cn(
                      "bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-white/20 transition-all",
                      !isRadiusFilterEnabled && "opacity-50 grayscale pointer-events-none"
                    )}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Raio de Busca</span>
                        <span className="text-xs font-black text-blue-600">{searchRadius} km</span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="50" 
                        value={searchRadius}
                        onChange={(e) => setSearchRadius(Number(e.target.value))}
                        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                      <p className="text-[8px] text-gray-400 mt-2 font-bold text-center uppercase tracking-tighter">
                        {isRadiusFilterEnabled ? "Clique no mapa para definir um novo centro de busca" : "Ative o filtro de raio para buscar por proximidade"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    {filteredProviders.length > 0 ? (
                      filteredProviders.map((provider) => (
                        <motion.div 
                          key={provider.uid}
                          whileHover={{ y: -2 }}
                          onClick={() => {
                            setSelectedProvider(provider);
                            setView('profile');
                          }}
                          className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer flex gap-4"
                        >
                          <div className="relative">
                            <img src={provider.photoURL} alt={provider.name} className="w-16 h-16 rounded-xl object-cover" referrerPolicy="no-referrer" />
                            <UserStatusIndicator 
                              uid={provider.uid} 
                              className="absolute -top-1 -right-1 w-3 h-3 border-2" 
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-bold text-gray-900">{provider.name}</h3>
                                  <UserStatusIndicator uid={provider.uid} showText textClassName="text-[8px]" />
                                </div>
                                <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest mt-0.5">
                                  {provider.skills?.[0] || 'Profissional'}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                <motion.button
                                  whileHover={{ scale: 1.1 }}
                                  whileTap={{ scale: 0.9 }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(provider);
                                  }}
                                  className={cn(
                                    "p-2 rounded-full transition-colors",
                                    favorites.has(provider.uid) ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-400 hover:text-red-500"
                                  )}
                                >
                                  <Heart size={16} fill={favorites.has(provider.uid) ? "currentColor" : "none"} />
                                </motion.button>
                                {userLocation && provider.lat && provider.lng && (
                                  <div className="flex items-center gap-1 text-blue-600">
                                    <MapPin size={12} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">
                                      {calculateDistance(userLocation.lat, userLocation.lng, provider.lat, provider.lng).toFixed(1)} km
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1 text-yellow-500">
                                  <Star size={14} fill="currentColor" />
                                  <span className="text-sm font-bold">{provider.rating}</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-gray-500 line-clamp-1 mt-1">{provider.bio}</p>
                            <div className="flex gap-2 mt-2">
                              {provider.skills?.map(skill => (
                                <span key={skill} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold uppercase tracking-wider">
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-400 mb-4">
                          <Search size={32} />
                        </div>
                        <h3 className="font-bold text-gray-900">Nenhum resultado</h3>
                        <p className="text-gray-500 text-sm px-8">
                          {searchRadius !== 10 
                            ? `Não encontramos profissionais em um raio de ${searchRadius}km. Tente aumentar o raio de busca.` 
                            : "Tente buscar por outra categoria ou nome."}
                        </p>
                        {searchRadius !== 10 && (
                          <button 
                            onClick={() => setSearchRadius(50)}
                            className="mt-4 text-blue-600 font-bold text-sm hover:underline"
                          >
                            Aumentar raio para 50km
                          </button>
                        )}
                        {(minRating > 0 || selectedSpecialty || onlyAvailable || searchRadius !== 10) && (
                          <button 
                            onClick={resetFilters}
                            className="mt-2 block w-fit mx-auto text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:text-blue-600"
                          >
                            Limpar todos os filtros
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {hasMoreProviders && (
                    <motion.button 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setProvidersLimit(prev => prev + 10)}
                      disabled={loadingMore}
                      className="w-full py-4 bg-white border border-gray-100 rounded-2xl text-blue-600 font-bold text-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                    >
                      {loadingMore ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                      ) : (
                        <>
                          <Plus size={16} />
                          Carregar Mais Profissionais
                        </>
                      )}
                    </motion.button>
                  )}
                </>
              )}

              {/* Filter Modal */}
              <AnimatePresence>
                {isFilterModalOpen && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsFilterModalOpen(false)}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
                    />
                    <motion.div 
                      initial={{ y: '100%' }}
                      animate={{ y: 0 }}
                      exit={{ y: '100%' }}
                      className="fixed bottom-0 left-0 right-0 bg-white rounded-t-[32px] p-6 z-[70] shadow-2xl space-y-8 max-w-md mx-auto"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-xl font-black">Filtros</h3>
                        <button onClick={resetFilters} className="text-sm text-blue-600 font-bold">Limpar</button>
                      </div>

                      {/* Min Rating */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest">Avaliação Mínima</h4>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <button 
                              key={rating}
                              onClick={() => setMinRating(rating)}
                              className={cn(
                                "flex-1 py-3 rounded-xl border font-bold transition-all flex items-center justify-center gap-1",
                                minRating === rating 
                                  ? "bg-blue-600 border-blue-600 text-white" 
                                  : "bg-white border-gray-100 text-gray-600"
                              )}
                            >
                              {rating} <Star size={12} fill={minRating === rating ? "white" : "currentColor"} />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Specialty */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest">Especialidade</h4>
                        <div className="flex flex-wrap gap-2">
                          {CATEGORIES.map((cat) => (
                            <button 
                              key={cat.name}
                              onClick={() => setSelectedSpecialty(selectedSpecialty === cat.name ? null : cat.name)}
                              className={cn(
                                "px-4 py-2 rounded-xl border font-bold transition-all text-sm",
                                selectedSpecialty === cat.name 
                                  ? "bg-blue-600 border-blue-600 text-white" 
                                  : "bg-white border-gray-100 text-gray-600"
                              )}
                            >
                              {cat.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Online Status */}
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-3 h-3 rounded-full", onlyAvailable ? "bg-green-500 animate-pulse" : "bg-gray-300")} />
                          <div>
                            <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest">Online Agora</h4>
                            <p className="text-[10px] text-gray-400 font-bold">Mostrar apenas profissionais ativos</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setOnlyAvailable(!onlyAvailable)}
                          className={cn(
                            "w-12 h-6 rounded-full transition-all relative",
                            onlyAvailable ? "bg-blue-600" : "bg-gray-200"
                          )}
                        >
                          <div className={cn(
                            "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                            onlyAvailable ? "left-7" : "left-1"
                          )} />
                        </button>
                      </div>

                      {/* Search Radius */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest">Raio de Busca</h4>
                            <button 
                              onClick={() => setIsRadiusFilterEnabled(!isRadiusFilterEnabled)}
                              className={cn(
                                "text-[10px] font-black uppercase px-2 py-0.5 rounded-md transition-all",
                                isRadiusFilterEnabled ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"
                              )}
                            >
                              {isRadiusFilterEnabled ? 'Ativado' : 'Desativado'}
                            </button>
                          </div>
                          <span className={cn("font-black transition-colors", isRadiusFilterEnabled ? "text-blue-600" : "text-gray-300")}>
                            {searchRadius} km
                          </span>
                        </div>
                        <div className={cn("space-y-4 transition-all", !isRadiusFilterEnabled && "opacity-40 pointer-events-none")}>
                          <input 
                            type="range" 
                            min="1" 
                            max="50" 
                            step="1"
                            value={searchRadius}
                            onChange={(e) => setSearchRadius(Number(e.target.value))}
                            className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                          />
                          <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            <span>1 km</span>
                            <span>25 km</span>
                            <span>50 km</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            if ("geolocation" in navigator) {
                              navigator.geolocation.getCurrentPosition(
                                (position) => {
                                  setUserLocation({
                                    lat: position.coords.latitude,
                                    lng: position.coords.longitude,
                                  });
                                  setIsRadiusFilterEnabled(true);
                                  toast.success('Localização atualizada!');
                                },
                                () => toast.error('Erro ao obter localização.')
                              );
                            }
                          }}
                          className="w-full py-3 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-600 flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors"
                        >
                          <MapPin size={14} />
                          Atualizar minha localização
                        </button>
                      </div>

                      {/* Availability */}
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-green-500 shadow-sm">
                            <Zap size={20} />
                          </div>
                          <div>
                            <span className="block font-bold text-gray-900">Online Agora</span>
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Apenas disponíveis</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => setOnlyAvailable(!onlyAvailable)}
                          className={cn(
                            "w-12 h-6 rounded-full transition-all relative",
                            onlyAvailable ? "bg-green-500" : "bg-gray-200"
                          )}
                        >
                          <div className={cn(
                            "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                            onlyAvailable ? "right-1" : "left-1"
                          )} />
                        </button>
                      </div>

                      <button 
                        onClick={() => setIsFilterModalOpen(false)}
                        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-200"
                      >
                        Aplicar Filtros
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {view === 'profile' && selectedProvider && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="pb-20"
            >
              <div className="relative h-56 bg-gradient-to-br from-blue-600 to-blue-800">
                <button 
                  onClick={() => setView('search')}
                  className="absolute top-4 left-4 p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/30 transition-colors z-10"
                >
                  <ArrowLeft size={24} />
                </button>
                <div className="absolute top-4 right-4 flex gap-2 z-10">
                  <motion.button 
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    animate={{ scale: favorites.has(selectedProvider.uid) ? [1, 1.2, 1] : 1 }}
                    onClick={() => toggleFavorite(selectedProvider)}
                    className={cn(
                      "p-2 backdrop-blur-md rounded-full transition-colors",
                      favorites.has(selectedProvider.uid) 
                        ? "bg-red-500 text-white" 
                        : "bg-white/20 text-white hover:bg-white/30"
                    )}
                  >
                    <Heart size={24} fill={favorites.has(selectedProvider.uid) ? "currentColor" : "none"} />
                  </motion.button>
                  <button 
                    onClick={() => setIsShareModalOpen(true)}
                    className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/30 transition-colors"
                  >
                    <Share2 size={24} />
                  </button>
                </div>
                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
              </div>
              
              <div className="px-4 -mt-16 relative z-10">
                <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
                  {/* Profile Header */}
                  <div className="p-6 flex flex-col items-center text-center border-b border-gray-50">
                    <div className="relative group">
                      <img 
                        src={selectedProvider.photoURL} 
                        alt={selectedProvider.name} 
                        className="w-32 h-32 rounded-3xl object-cover border-4 border-white shadow-xl mb-4" 
                        referrerPolicy="no-referrer" 
                      />
                      {user?.uid === selectedProvider.uid && (
                        <div className="absolute bottom-4 right-0 p-2 bg-blue-600 text-white rounded-xl shadow-lg border-2 border-white group-hover:scale-110 transition-transform">
                          <Camera size={16} />
                        </div>
                      )}
                      {user?.uid === selectedProvider.uid && (
                        <div 
                          onClick={() => !isUploadingImage && setIsPhotoModalOpen(true)}
                          className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          {isUploadingImage ? (
                            <div className="flex flex-col items-center gap-2 px-4 w-full">
                              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${uploadProgress}%` }}
                                  className="h-full bg-white"
                                />
                              </div>
                              <span className="text-[8px] font-black text-white uppercase tracking-widest">
                                {Math.round(uploadProgress)}%
                              </span>
                            </div>
                          ) : (
                            <Camera className="text-white" size={32} />
                          )}
                        </div>
                      )}
                      <UserStatusIndicator 
                        uid={selectedProvider.uid} 
                        className="absolute -bottom-2 -right-2 w-6 h-6 border-4" 
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-black text-gray-900 tracking-tight">{selectedProvider.name}</h2>
                        <UserStatusIndicator 
                          uid={selectedProvider.uid} 
                          showText 
                          className="mt-1"
                          textClassName="text-[10px]"
                        />
                      </div>
                      {user?.uid === selectedProvider.uid && (
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                          Dica: Clique na foto para atualizar
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-blue-600 font-bold text-sm uppercase tracking-widest">
                        {selectedProvider.skills?.[0] || 'Prestador Verificado'}
                      </p>
                      {userLocation && selectedProvider.lat && selectedProvider.lng && (
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[8px] font-black uppercase tracking-widest">
                          <MapPin size={8} />
                          {calculateDistance(userLocation.lat, userLocation.lng, selectedProvider.lat, selectedProvider.lng).toFixed(1)} km
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-6 mt-6 w-full">
                      <div className="flex-1 text-center">
                        <div className="text-xl font-black text-gray-900">{selectedProvider.rating?.toFixed(1) || '0.0'}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Avaliação</div>
                      </div>
                      <div className="w-px h-8 bg-gray-100"></div>
                      <div className="flex-1 text-center">
                        <div className="text-xl font-black text-gray-900">{selectedProvider.reviewCount || 0}</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Trabalhos</div>
                      </div>
                      <div className="w-px h-8 bg-gray-100"></div>
                      <div className="flex-1 text-center">
                        <div className="text-xl font-black text-gray-900">98%</div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Sucesso</div>
                      </div>
                    </div>
                  </div>

                  {/* Profile Body */}
                  <div className="p-6 space-y-8">
                    {/* Rating Prompt for Clients */}
                    {user?.uid !== selectedProvider.uid && tasks.find(t => t.providerId === selectedProvider.uid && t.status === 'completed' && !t.rated) && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-yellow-50 border border-yellow-100 rounded-3xl flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-yellow-100 text-yellow-600 rounded-xl flex items-center justify-center">
                            <Star size={20} fill="currentColor" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-gray-900 uppercase tracking-tight">Avalie este Profissional</p>
                            <p className="text-[10px] text-gray-500 font-medium">Você concluiu um serviço recentemente.</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            const unratedTask = tasks.find(t => t.providerId === selectedProvider.uid && t.status === 'completed' && !t.rated);
                            if (unratedTask) {
                              setTaskToRate(unratedTask);
                              setIsRatingModalOpen(true);
                            }
                          }}
                          className="px-4 py-2 bg-yellow-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-yellow-600 transition-colors shadow-lg shadow-yellow-100"
                        >
                          Avaliar
                        </button>
                      </motion.div>
                    )}

                    {/* About Section */}
                    <section 
                      className={cn(
                        "space-y-3 p-4 -mx-4 rounded-3xl transition-colors group/section",
                        user?.uid === selectedProvider.uid && !isEditingBio && "hover:bg-blue-50/50 cursor-pointer"
                      )}
                      onClick={() => {
                        if (user?.uid === selectedProvider.uid && !isEditingBio) {
                          setTempBio(selectedProvider.bio || '');
                          setIsEditingBio(true);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                           <User size={20} className="text-blue-600" />
                           Sobre o Profissional
                        </h3>
                        {user?.uid === selectedProvider.uid && !isEditingBio && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setTempBio(selectedProvider.bio || '');
                              setIsEditingBio(true);
                            }}
                            className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Sparkles size={12} />
                            Editar
                          </button>
                        )}
                      </div>
                      
                      {isEditingBio ? (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <textarea 
                            value={tempBio}
                            onChange={(e) => setTempBio(e.target.value)}
                            autoFocus
                            className="w-full p-4 bg-white border-2 border-blue-100 rounded-2xl text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none min-h-[150px] shadow-sm transition-all"
                            placeholder="Conte um pouco sobre sua experiência..."
                          />
                          <div className="flex gap-2">
                            <button 
                              onClick={handleSaveProfile}
                              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
                            >
                              Salvar Alterações
                            </button>
                            <button 
                              onClick={() => setIsEditingBio(false)}
                              className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 transition-all"
                            >
                              Cancelar
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        <p className="text-gray-600 leading-relaxed text-sm font-medium">
                          {selectedProvider.bio || "Nenhuma biografia informada."}
                        </p>
                      )}
                      {user?.uid === selectedProvider.uid && (
                        <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-2xl flex items-center gap-3">
                          <div className="w-8 h-8 bg-green-100 text-green-600 rounded-xl flex items-center justify-center">
                            <Zap size={16} />
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-green-700 uppercase tracking-widest">Otimização Ativa</p>
                            <p className="text-[10px] text-green-600 font-medium">Suas imagens são comprimidas para economizar dados.</p>
                          </div>
                        </div>
                      )}
                      {selectedProvider.lat && selectedProvider.lng && (
                        <button 
                          onClick={() => {
                            setSearchMode('map');
                            setView('search');
                          }}
                          className="mt-4 flex items-center gap-2 text-blue-600 font-bold text-xs hover:underline"
                        >
                          <MapPin size={14} />
                          Ver localização no mapa
                        </button>
                      )}
                    </section>

                    {/* Availability Section */}
                    <section className="space-y-3">
                      <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                        <Zap size={20} className={selectedProvider.isOnline ? "text-green-500" : "text-gray-400"} />
                        Disponibilidade
                      </h3>
                      <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <div className={cn(
                          "w-3 h-3 rounded-full animate-pulse",
                          selectedProvider.isOnline ? "bg-green-500" : "bg-gray-400"
                        )} />
                        <div>
                          <p className="text-sm font-bold text-gray-900">
                            {selectedProvider.isOnline ? "Disponível agora" : "Indisponível no momento"}
                          </p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                            {selectedProvider.isOnline ? "Pode responder em minutos" : "Responde em algumas horas"}
                          </p>
                        </div>
                      </div>
                    </section>

                    {/* Phone Section (Always visible for editing if own profile) */}
                    {user?.uid === selectedProvider.uid && (
                      <section className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            <Phone size={20} className="text-blue-600" />
                            Seu Telefone
                          </h3>
                          {!isEditingPhone && (
                            <button 
                              onClick={() => {
                                setTempPhone(selectedProvider.phone || '');
                                setIsEditingPhone(true);
                              }}
                              className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline"
                            >
                              Editar
                            </button>
                          )}
                        </div>
                        {isEditingPhone ? (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="p-5 bg-blue-50/50 rounded-3xl border border-blue-100 space-y-4"
                          >
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block ml-1">
                                Número de Telefone
                              </label>
                              <div className="relative">
                                <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input 
                                  type="tel"
                                  value={tempPhone}
                                  onChange={(e) => setTempPhone(e.target.value)}
                                  placeholder="Digite seu número..."
                                  className="w-full pl-12 pr-4 py-4 bg-white border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none shadow-sm transition-all"
                                  autoFocus
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={handleSaveProfile}
                                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                              >
                                <Save size={14} />
                                Salvar
                              </button>
                              <button 
                                onClick={() => setIsEditingPhone(false)}
                                className="px-6 py-3 bg-white border border-gray-100 text-gray-500 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 transition-all"
                              >
                                Cancelar
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          <div 
                            onClick={() => {
                              setTempPhone(selectedProvider.phone || '');
                              setIsEditingPhone(true);
                            }}
                            className="p-5 bg-gray-50 rounded-3xl border border-gray-100 flex items-center justify-between cursor-pointer hover:bg-blue-50/50 hover:border-blue-100 transition-all group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-blue-600 shadow-sm border border-gray-50">
                                <Phone size={24} />
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-lg font-black text-gray-900 tracking-tight">
                                  {selectedProvider.phone || "Não informado"}
                                </p>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                  {selectedProvider.phone ? "Toque para alterar" : "Toque para adicionar"}
                                </p>
                              </div>
                            </div>
                            <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                          </div>
                        )}
                      </section>
                    )}

                    {/* Preferences & Appearance Section */}
                    {user?.uid === selectedProvider.uid && (
                      <section className="space-y-4">
                        <h3 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                          <Palette size={20} className="text-blue-600" />
                          {t('appearance')} & {t('language')}
                        </h3>
                        <div className="p-5 bg-gray-50 dark:bg-white/5 rounded-3xl border border-gray-100 dark:border-white/10 space-y-6">
                          {/* Theme Selector */}
                          <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                              {t('theme')}
                            </label>
                            <div className="flex p-1 bg-white dark:bg-black/20 rounded-2xl border border-gray-100 dark:border-white/10">
                              <button
                                onClick={() => setTheme('light')}
                                className={cn(
                                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
                                  theme === 'light' 
                                    ? "bg-blue-600 text-white shadow-lg" 
                                    : "text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5"
                                )}
                              >
                                <Sun size={14} />
                                {t('light')}
                              </button>
                              <button
                                onClick={() => setTheme('dark')}
                                className={cn(
                                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
                                  theme === 'dark' 
                                    ? "bg-blue-600 text-white shadow-lg" 
                                    : "text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5"
                                )}
                              >
                                <Moon size={14} />
                                {t('dark')}
                              </button>
                            </div>
                          </div>

                          {/* Language Selector */}
                          <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                              {t('language')}
                            </label>
                            <div className="flex p-1 bg-white dark:bg-black/20 rounded-2xl border border-gray-100 dark:border-white/10">
                              <button
                                onClick={() => setLanguage('pt')}
                                className={cn(
                                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
                                  language === 'pt' 
                                    ? "bg-blue-600 text-white shadow-lg" 
                                    : "text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5"
                                )}
                              >
                                <Globe size={14} />
                                Português
                              </button>
                              <button
                                onClick={() => setLanguage('en')}
                                className={cn(
                                  "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
                                  language === 'en' 
                                    ? "bg-blue-600 text-white shadow-lg" 
                                    : "text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5"
                                )}
                              >
                                <Globe size={14} />
                                English
                              </button>
                            </div>
                          </div>
                        </div>
                      </section>
                    )}

                    {/* Notification Settings Section */}
                    {user?.uid === selectedProvider.uid && (
                      <section id="notification-settings" className="space-y-4 scroll-mt-20">
                        <h3 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                          <Bell size={20} className="text-blue-600" />
                          {t('notificationSettings')}
                        </h3>
                        <div className="p-5 bg-blue-50/50 dark:bg-blue-500/10 rounded-3xl border border-blue-100 dark:border-blue-500/20 space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                              {t('reminderLeadTime')}
                            </label>
                            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-3">
                              {t('reminderDescription')}
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              {[15, 30, 60, 120, 1440].map((time) => (
                                <button
                                  key={time}
                                  onClick={() => {
                                    setReminderLeadTime(time);
                                    localStorage.setItem('reminder_lead_time', time.toString());
                                    const timeStr = time >= 60 
                                      ? (time >= 1440 ? `${time/1440} ${t('day_singular')}` : `${time/60} ${t('hours')}`) 
                                      : `${time} ${t('minutes')}`;
                                    toast.success(`${t('reminderLeadTime')} ${t('activated')} (${timeStr} ${t('before')}).`);
                                  }}
                                  className={cn(
                                    "py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                                    reminderLeadTime === time 
                                      ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100 dark:shadow-none" 
                                      : "bg-white dark:bg-white/5 text-gray-400 border-gray-100 dark:border-white/10 hover:border-blue-200"
                                  )}
                                >
                                  {time >= 60 
                                    ? (time >= 1440 ? `${time/1440} ${t('day_singular')}` : `${time/60} ${t('hours')}`) 
                                    : `${time} ${t('minutes').substring(0, 3)}`}
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          <div className="pt-4 border-t border-blue-100 dark:border-blue-500/20 flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-xs font-bold text-gray-900 dark:text-white">{t('pushNotifications')}</p>
                              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">{t('status')}: {Notification.permission === 'granted' ? t('activated') : t('deactivated')}</p>
                            </div>
                            {Notification.permission !== 'granted' && (
                              <button 
                                onClick={() => Notification.requestPermission().then(() => setView('profile'))}
                                className="px-4 py-2 bg-white dark:bg-white/5 border border-blue-200 dark:border-blue-500/30 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all"
                              >
                                {t('enable')}
                              </button>
                            )}
                          </div>
                        </div>
                      </section>
                    )}

                    {/* Skills Section */}
                    <section 
                      className={cn(
                        "space-y-3 p-4 -mx-4 rounded-3xl transition-colors group/section",
                        user?.uid === selectedProvider.uid && !isEditingSkills && "hover:bg-blue-50/50 cursor-pointer"
                      )}
                      onClick={() => {
                        if (user?.uid === selectedProvider.uid && !isEditingSkills) {
                          setTempSkills(selectedProvider.skills || []);
                          setIsEditingSkills(true);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                          <Plus size={20} className="text-blue-600" />
                          Especialidades
                        </h3>
                        {user?.uid === selectedProvider.uid && !isEditingSkills && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setTempSkills(selectedProvider.skills || []);
                              setIsEditingSkills(true);
                            }}
                            className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                          >
                            <Sparkles size={12} />
                            Editar
                          </button>
                        )}
                      </div>

                      {isEditingSkills ? (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-wrap gap-2 p-4 bg-white border-2 border-blue-100 rounded-2xl shadow-inner min-h-[60px]">
                            {tempSkills.map((skill, index) => (
                              <motion.div 
                                layout
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                key={index} 
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-xl flex items-center gap-2 shadow-sm shadow-blue-100"
                              >
                                <span className="text-xs font-bold">{skill}</span>
                                <button 
                                  onClick={() => setTempSkills(prev => prev.filter((_, i) => i !== index))}
                                  className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
                                >
                                  <X size={14} />
                                </button>
                              </motion.div>
                            ))}
                            {tempSkills.length === 0 && (
                              <span className="text-xs text-gray-400 italic">Nenhuma especialidade adicionada.</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              id="new-skill-input"
                              placeholder="Adicionar nova especialidade..."
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const val = (e.target as HTMLInputElement).value.trim();
                                  if (val && !tempSkills.includes(val)) {
                                    setTempSkills([...tempSkills, val]);
                                    (e.target as HTMLInputElement).value = '';
                                  }
                                }
                              }}
                              className="flex-1 p-4 bg-white border-2 border-gray-100 rounded-2xl text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none transition-all"
                            />
                            <button 
                              onClick={() => {
                                const input = document.getElementById('new-skill-input') as HTMLInputElement;
                                const val = input.value.trim();
                                if (val && !tempSkills.includes(val)) {
                                  setTempSkills([...tempSkills, val]);
                                  input.value = '';
                                }
                              }}
                              className="px-6 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                            >
                              Adicionar
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={handleSaveProfile}
                              className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
                            >
                              Salvar Especialidades
                            </button>
                            <button 
                              onClick={() => setIsEditingSkills(false)}
                              className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 transition-all"
                            >
                              Cancelar
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {selectedProvider.skills?.map(skill => (
                            <div key={skill} className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl flex items-center gap-2 group hover:border-blue-200 transition-colors">
                              <CheckCircle2 size={14} className="text-blue-500" />
                              <span className="text-sm font-bold text-gray-700">{skill}</span>
                            </div>
                          ))}
                          {(!selectedProvider.skills || selectedProvider.skills.length === 0) && (
                            <span className="text-sm text-gray-400 italic">Nenhuma especialidade informada.</span>
                          )}
                        </div>
                      )}
                    </section>

                    {/* Portfolio Section */}
                    {selectedProvider.portfolio && selectedProvider.portfolio.length > 0 && (
                      <section className="space-y-4">
                        <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                          <Briefcase size={20} className="text-blue-600" />
                          Portfólio de Trabalhos
                        </h3>
                        <div className="grid grid-cols-1 gap-4">
                          {selectedProvider.portfolio.map((item) => (
                            <motion.div 
                              key={item.id} 
                              whileHover={{ y: -4 }}
                              onClick={() => setSelectedPortfolioImage(item)}
                              className="group relative overflow-hidden rounded-3xl border border-gray-100 bg-gray-50 transition-all hover:shadow-xl cursor-pointer"
                            >
                              <div className="aspect-video w-full overflow-hidden relative">
                                <img 
                                  src={item.imageURL} 
                                  alt={item.title} 
                                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
                                  referrerPolicy="no-referrer"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <div className="opacity-0 group-hover:opacity-100 transform translate-y-4 group-hover:translate-y-0 transition-all bg-white/90 backdrop-blur-sm p-3 rounded-2xl text-blue-600 shadow-xl">
                                    <ExternalLink size={24} />
                                  </div>
                                </div>
                              </div>
                              <div className="p-5">
                                <h4 className="font-black text-gray-900 text-lg tracking-tight">{item.title}</h4>
                                <p className="mt-1 text-sm text-gray-500 leading-relaxed font-medium">{item.description}</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Location & Availability */}
                    <section className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-1">
                        <div className="flex items-center gap-2 text-blue-600">
                          <MapPin size={16} />
                          <span className="text-[10px] font-black uppercase tracking-widest">Localização</span>
                        </div>
                        <p className="text-sm font-bold text-blue-900">Luanda, Angola</p>
                      </div>
                      <div className="p-4 bg-green-50 rounded-2xl border border-green-100 space-y-1">
                        <div className="flex items-center gap-2 text-green-600">
                          <Zap size={16} />
                          <span className="text-[10px] font-black uppercase tracking-widest">Resposta</span>
                        </div>
                        <p className="text-sm font-bold text-green-900">~15 minutos</p>
                      </div>
                    </section>

                    {/* Reviews Preview */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-black text-gray-900">Avaliações Recentes</h3>
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                          {providerReviews.length} Comentários
                        </div>
                      </div>
                      <div className="space-y-3">
                        {providerReviews.length > 0 ? (
                          providerReviews.map((review) => (
                            <div key={review.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                                    {review.clientName.charAt(0)}
                                  </div>
                                  <span className="text-sm font-bold text-gray-900">{review.clientName}</span>
                                </div>
                                <div className="flex items-center gap-0.5 text-yellow-500">
                                  {[...Array(5)].map((_, star) => (
                                    <Star 
                                      key={star} 
                                      size={10} 
                                      fill={star < review.rating ? "currentColor" : "none"} 
                                      className={star < review.rating ? "" : "text-gray-300"}
                                    />
                                  ))}
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 font-medium italic">
                                "{review.comment || 'Sem comentário.'}"
                              </p>
                              <div className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">
                                {review.createdAt?.toDate ? review.createdAt.toDate().toLocaleDateString() : 'Recentemente'}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Ainda não há avaliações</p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>

                  {/* Action Bar */}
                  <div className="p-6 bg-gray-50 border-t border-gray-100 space-y-4">
                    {user?.uid !== selectedProvider.uid && (
                      <div className="grid grid-cols-2 gap-3">
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleContact('call')}
                          className="py-3 bg-white border-2 border-green-100 text-green-600 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-green-50 transition-all shadow-sm"
                        >
                          <Phone size={16} />
                          Ligar
                        </motion.button>
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleContact('whatsapp')}
                          className="py-3 bg-green-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-green-600 transition-all shadow-lg shadow-green-100"
                        >
                          <MessageCircle size={16} />
                          WhatsApp
                        </motion.button>
                      </div>
                    )}

                    {isScheduling ? (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-4 bg-white p-4 rounded-2xl border border-blue-100 shadow-sm"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                            <Calendar size={16} className="text-blue-600" />
                            Agendar Serviço
                          </h4>
                          <button 
                            onClick={() => setIsScheduling(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Título do Serviço</label>
                            <input 
                              type="text"
                              value={scheduleTitle}
                              onChange={(e) => setScheduleTitle(e.target.value)}
                              placeholder="Ex: Limpeza de Ar Condicionado"
                              className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Data</label>
                              <input 
                                type="date"
                                value={scheduleDate}
                                onChange={(e) => setScheduleDate(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Hora</label>
                              <input 
                                type="time"
                                value={scheduleTime}
                                onChange={(e) => setScheduleTime(e.target.value)}
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                              />
                            </div>
                          </div>
                          <motion.button 
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleScheduleBooking}
                            className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
                          >
                            Confirmar Agendamento
                          </motion.button>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="flex gap-3">
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98, boxShadow: "0 0 25px rgba(37, 99, 235, 0.4)" }}
                          onClick={() => setView('chat')}
                          className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-3"
                        >
                          <MessageSquare size={22} />
                          Contratar Profissional
                        </motion.button>
                        <motion.button 
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setIsScheduling(true)}
                          className="px-6 py-4 bg-white border-2 border-blue-600 text-blue-600 rounded-2xl font-black text-lg hover:bg-blue-50 transition-all flex items-center justify-center gap-3"
                        >
                          <Calendar size={24} />
                        </motion.button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Dashboard do Prestador</h2>
                <div className="bg-green-100 text-green-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                  Online
                </div>
              </div>

              {/* Notification Status */}
              <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-2xl flex items-center justify-center",
                    Notification.permission === 'granted' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                  )}>
                    <Bell size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Notificações Push</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                      {Notification.permission === 'granted' ? 'Ativadas' : 'Desativadas'}
                    </p>
                  </div>
                </div>
                {Notification.permission !== 'granted' && (
                  <button 
                    onClick={() => Notification.requestPermission().then(() => setView('dashboard'))}
                    className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1.5 rounded-xl hover:bg-blue-100 transition-colors"
                  >
                    Ativar
                  </button>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-2">
                  <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                    <DollarSign size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Total Ganhos</p>
                    <p className="text-xl font-black text-gray-900">
                      Kz {providerTasks.filter(t => t.status === 'completed').reduce((acc, t) => acc + (t.price || 0), 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-2">
                  <div className="w-10 h-10 bg-yellow-50 rounded-2xl flex items-center justify-center text-yellow-600">
                    <Star size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Avaliação Média</p>
                    <p className="text-xl font-black text-gray-900">
                      {myReviews.length > 0 
                        ? (myReviews.reduce((acc, r) => acc + r.rating, 0) / myReviews.length).toFixed(1)
                        : '0.0'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Agendamentos Section */}
              <div 
                onClick={() => setView('schedules')}
                className="bg-white p-5 rounded-3xl border border-blue-100 shadow-sm flex items-center justify-between cursor-pointer group hover:border-blue-300 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                    <Calendar size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Agendamentos</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                      {providerTasks.filter(t => t.scheduledAt).length} Compromissos
                    </p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
              </div>

              {/* Sudoku Relax Section */}
              <div 
                onClick={() => setView('sudoku')}
                className="bg-gradient-to-br from-indigo-600 to-blue-700 p-6 rounded-3xl shadow-lg shadow-indigo-100 flex items-center justify-between cursor-pointer group hover:scale-[1.02] transition-all"
              >
                <div className="space-y-1">
                  <h3 className="text-white font-black text-lg">Sudoku Relax</h3>
                  <p className="text-indigo-100 text-xs font-medium">Faça uma pausa e exercite sua mente.</p>
                </div>
                <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-white group-hover:rotate-12 transition-transform">
                  <Sparkles size={24} />
                </div>
              </div>

              {/* Profile Shortcut */}
              <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl overflow-hidden border-2 border-blue-50">
                    <img src={user?.photoURL || ''} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{user?.displayName}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Seu Perfil Público</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    if (user) {
                      const myProfile = {
                        uid: user.uid,
                        name: user.displayName || 'Meu Perfil',
                        photoURL: user.photoURL || 'https://picsum.photos/seed/user/200/200',
                        role: userRole,
                        bio: 'Este é o seu perfil. Clique na foto para editá-la.',
                        skills: userRole === 'provider' ? ['Geral'] : []
                      } as any;
                      setSelectedProvider(myProfile);
                      setView('profile');
                    }
                  }}
                  className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1.5 rounded-xl hover:bg-blue-100 transition-colors"
                >
                  Ver Perfil
                </button>
              </div>

              {/* Active Tasks */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-gray-900 uppercase tracking-tight text-sm">Tarefas Ativas</h3>
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    {providerTasks.filter(t => t.status === 'accepted').length}
                  </span>
                </div>
                <div className="space-y-3">
                  {providerTasks.filter(t => t.status === 'accepted').length > 0 ? (
                    providerTasks.filter(t => t.status === 'accepted').map(task => (
                      <div key={task.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-gray-900 text-sm">{task.title}</p>
                            <UserStatusIndicator uid={task.clientId} />
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-gray-400 font-medium">Cliente: {task.clientName}</p>
                            <UserStatusIndicator uid={task.clientId} showText />
                          </div>
                          <p className="text-[10px] text-gray-400 font-medium italic">Iniciada em {task.createdAt?.toDate ? task.createdAt.toDate().toLocaleDateString() : 'Hoje'}</p>
                        </div>
                        <button 
                          onClick={() => {
                            // Find client to chat
                            const clientProv = {
                              uid: task.clientId,
                              name: task.clientName || 'Cliente',
                              photoURL: 'https://picsum.photos/seed/client/200/200',
                              role: 'client'
                            } as any;
                            setSelectedProvider(clientProv);
                            setSelectedTask(task);
                            setView('chat');
                          }}
                          className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                        >
                          <MessageSquare size={18} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                      <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Nenhuma tarefa ativa</p>
                    </div>
                  )}
                </div>

                {providerTasks.filter(t => t.status === 'accepted').length >= providerTasksLimit && (
                  <motion.button 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setProviderTasksLimit(prev => prev + 10)}
                    className="w-full py-3 bg-white border border-gray-100 rounded-2xl text-blue-600 font-bold text-xs hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={14} />
                    Ver Mais Tarefas Ativas
                  </motion.button>
                )}
              </section>

              {/* Recent Reviews */}
              <section className="space-y-4">
                <h3 className="font-black text-gray-900 uppercase tracking-tight text-sm">Avaliações Recentes</h3>
                <div className="space-y-3">
                  {myReviews.length > 0 ? (
                    myReviews.map(review => (
                      <div key={review.id} className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-gray-900 text-xs">{review.clientName}</p>
                          <div className="flex items-center gap-0.5 text-yellow-500">
                            <Star size={10} fill="currentColor" />
                            <span className="text-[10px] font-black">{review.rating}</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 italic">"{review.comment}"</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                      <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Sem avaliações ainda</p>
                    </div>
                  )}
                </div>
              </section>
            </motion.div>
          )}

          {view === 'sudoku' && (
            <motion.div 
              key="sudoku"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="p-4"
            >
              <SudokuGame onClose={() => setView('dashboard')} />
            </motion.div>
          )}

          {view === 'chats' && (
            <motion.div 
              key="chats"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Minhas Conversas</h2>
                <div className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                  {userChats.length} Ativas
                </div>
              </div>

              <div className="space-y-3">
                {userChats.length > 0 ? (
                  userChats.map((chat) => {
                    const isProvider = user?.uid !== chat.participants[0]; // Simple logic for demo
                    const otherName = isProvider ? chat.clientName : chat.providerName;
                    const otherPhoto = isProvider ? chat.clientPhoto : chat.providerPhoto;
                    
                    return (
                      <button 
                        key={chat.id}
                        onClick={() => {
                          // Find the provider object from MOCK_PROVIDERS or current providers
                          const prov = providers.find(p => p.uid === (chat.participants.find((id: string) => id !== user?.uid)));
                          if (prov) {
                            setSelectedProvider(prov);
                            setView('chat');
                          } else {
                            toast.error('Profissional não encontrado.');
                          }
                        }}
                        className="w-full bg-white rounded-3xl p-4 border border-gray-100 shadow-sm flex items-center gap-4 hover:border-blue-200 transition-all text-left"
                      >
                        <img src={otherPhoto} alt={otherName} className="w-14 h-14 rounded-2xl object-cover" referrerPolicy="no-referrer" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <h3 className="font-bold text-gray-900 truncate">{otherName}</h3>
                              <UserStatusIndicator uid={chat.participants.find((id: string) => id !== user?.uid)} showText={false} dotOnly />
                            </div>
                            <span className="text-[10px] text-gray-400 font-medium">
                              {chat.lastTimestamp?.seconds 
                                ? new Date(chat.lastTimestamp.seconds * 1000).toLocaleDateString()
                                : 'Agora'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 truncate font-medium">{chat.lastMessage}</p>
                        </div>
                        <ChevronRight size={20} className="text-gray-300" />
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center py-12 space-y-4">
                    <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-300">
                      <MessageSquare size={40} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-gray-900">Nenhuma conversa</h3>
                      <p className="text-sm text-gray-500">Suas conversas aparecerão aqui.</p>
                    </div>
                  </div>
                )}
              </div>

              {hasMoreChats && userChats.length >= chatsLimit && (
                <motion.button 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setChatsLimit(prev => prev + 10)}
                  disabled={loadingMore}
                  className="w-full py-4 bg-white border border-gray-100 rounded-2xl text-blue-600 font-bold text-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-2 mt-4"
                >
                  {loadingMore ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <Plus size={16} />
                      Carregar Mais Conversas
                    </>
                  )}
                </motion.button>
              )}
            </motion.div>
          )}

          {view === 'job_offers' && (
            <motion.div 
              key="job_offers"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-6"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Ofertas de Serviço</h2>
                <div className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                  {jobs.length} Disponíveis
                </div>
              </div>

              <div className="space-y-4">
                {jobs.length > 0 ? (
                  jobs.map((job) => (
                    <div key={job.id} className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <h3 className="font-bold text-gray-900">{job.title}</h3>
                          <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                            <User size={12} />
                            {job.clientName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                            {job.category}
                          </div>
                          <JobTimer createdAt={job.createdAt} />
                        </div>
                      </div>

                      <p className="text-sm text-gray-600 line-clamp-2">{job.description}</p>

                      <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                        <div className="flex items-center gap-1 text-blue-600 text-xs font-bold">
                          <MapPin size={14} />
                          {userLocation ? `${calculateDistance(userLocation.lat, userLocation.lng, job.lat, job.lng).toFixed(1)} km` : 'Localização...'}
                        </div>
                        <button 
                          onClick={() => applyToJob(job)}
                          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                        >
                          Aceitar Serviço
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 space-y-4">
                    <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-300">
                      <Briefcase size={40} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-gray-900">Nenhuma oferta no momento</h3>
                      <p className="text-sm text-gray-500">Fique atento às notificações!</p>
                    </div>
                  </div>
                )}
              </div>

              {hasMoreJobs && jobs.length >= jobsLimit && (
                <motion.button 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setJobsLimit(prev => prev + 10)}
                  className="w-full py-4 bg-white border border-gray-100 rounded-2xl text-blue-600 font-bold text-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Plus size={16} />
                  Ver Mais Solicitações
                  </motion.button>
              )}
            </motion.div>
          )}

          {view === 'tasks' && (
            <motion.div 
              key="tasks"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-6"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight">Minhas Tarefas</h2>
                  {!isOnline && (
                    <div className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                      <WifiOff size={10} />
                      Cache
                    </div>
                  )}
                </div>

                {/* Tabs */}
                <div className="flex p-1 bg-gray-100 rounded-2xl">
                  <button 
                    onClick={() => setTaskTab('active')}
                    className={cn(
                      "flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                      taskTab === 'active' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400"
                    )}
                  >
                    Ativas
                  </button>
                  <button 
                    onClick={() => setTaskTab('completed')}
                    className={cn(
                      "flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                      taskTab === 'completed' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400"
                    )}
                  >
                    Concluídas
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {taskTab === 'active' ? (
                  <>
                    {/* Pending Jobs (Uber style) - Only for Clients */}
                    {userRole !== 'provider' && jobs.filter(j => j.clientId === user?.uid).map(job => (
                      <div key={job.id} className="bg-orange-50 rounded-3xl p-5 border border-orange-100 shadow-sm space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
                              <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Aguardando Profissionais</span>
                            </div>
                            <h3 className="font-bold text-gray-900">{job.title}</h3>
                            <p className="text-xs text-gray-500 font-medium">Sua solicitação está visível para profissionais próximos.</p>
                          </div>
                          <JobTimer createdAt={job.createdAt} />
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={async () => {
                              if (!isOnline) {
                                const stored = localStorage.getItem('offline_actions');
                                const queue = stored ? JSON.parse(stored) : [];
                                queue.push({
                                  type: 'delete_job',
                                  jobId: job.id
                                });
                                localStorage.setItem('offline_actions', JSON.stringify(queue));
                                toast.info('Cancelamento salvo offline. Será processado quando houver conexão.');
                                setJobs(prev => prev.filter(j => j.id !== job.id));
                                return;
                              }
                              await deleteDoc(doc(db, 'jobs', job.id));
                              toast.success('Solicitação cancelada.');
                            }}
                            className="flex-1 py-3 bg-white text-orange-600 border border-orange-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-100 transition-colors"
                          >
                            Cancelar Solicitação
                          </button>
                        </div>
                      </div>
                    ))}

                    {(() => {
                      const activeTasks = (userRole === 'provider' ? [...tasks, ...providerTasks] : tasks)
                        .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
                        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

                      if (activeTasks.length > 0 || (userRole !== 'provider' && jobs.filter(j => j.clientId === user?.uid).length > 0)) {
                        return activeTasks.map((task) => {
                          const isProviderForThisTask = task.providerId === user?.uid;
                          return (
                            <div key={task.id} className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm space-y-4">
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <h3 className="font-bold text-gray-900">{task.title}</h3>
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                      <User size={12} />
                                      {isProviderForThisTask ? (task.clientName || 'Cliente') : task.providerName}
                                    </p>
                                    <UserStatusIndicator uid={isProviderForThisTask ? task.clientId : task.providerId} showText />
                                  </div>
                                  {task.scheduledAt && (
                                    <div className="flex items-center gap-2 mt-2 p-2 bg-blue-50 rounded-xl border border-blue-100">
                                      <Calendar size={14} className="text-blue-600" />
                                      <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">
                                        Agendado: {task.scheduledAt.toDate ? task.scheduledAt.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : new Date(task.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                                      </p>
                                    </div>
                                  )}
                                </div>
                                <div className={cn(
                                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                                  task.status === 'accepted' ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
                                )}>
                                  {task.status === 'accepted' ? 'Em Andamento' : 'Pendente'}
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                                <div className="text-sm font-black text-gray-900">
                                  {task.price ? `${task.price.toLocaleString()} Kz` : 'Preço a definir'}
                                </div>
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => {
                                      const otherId = isProviderForThisTask ? task.clientId : task.providerId;
                                      const otherUser: any = {
                                        uid: otherId,
                                        name: isProviderForThisTask ? (task.clientName || 'Cliente') : task.providerName,
                                        photoURL: `https://picsum.photos/seed/${otherId}/200/200`,
                                        role: isProviderForThisTask ? 'client' : 'provider'
                                      };
                                      setSelectedProvider(otherUser);
                                      setSelectedTask(task);
                                      setView('chat');
                                    }}
                                    className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                                  >
                                    <MessageSquare size={18} />
                                  </button>
                                  {!isProviderForThisTask && task.status === 'accepted' && (
                                    <button 
                                      onClick={() => completeTask(task)}
                                      className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-100"
                                    >
                                      Concluir
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        });
                      } else {
                        return (
                          <div className="text-center py-12 space-y-4">
                            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-300">
                              <Briefcase size={40} />
                            </div>
                            <div className="space-y-1">
                              <h3 className="font-bold text-gray-900">Nenhuma tarefa ativa</h3>
                              <p className="text-sm text-gray-500">
                                {userRole === 'provider' ? 'Aguarde novas solicitações ou propostas.' : 'Contrate um profissional para começar.'}
                              </p>
                            </div>
                            {userRole !== 'provider' && (
                              <button 
                                onClick={() => setView('home')}
                                className="px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors"
                              >
                                Buscar Profissionais
                              </button>
                            )}
                          </div>
                        );
                      }
                    })()}
                  </>
                ) : (
                  <>
                    {/* Completed Tasks Section */}
                    {(() => {
                      const completedTasks = (userRole === 'provider' ? [...tasks, ...providerTasks] : tasks)
                        .filter(t => t.status === 'completed')
                        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

                      if (completedTasks.length > 0) {
                        return completedTasks.map((task) => {
                          const isProviderForThisTask = task.providerId === user?.uid;
                          return (
                            <div key={task.id} className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm space-y-4 overflow-hidden relative">
                              <div className="absolute top-0 right-0 w-12 h-12 bg-green-50 rounded-bl-[32px] flex items-center justify-center text-green-600">
                                <CheckCircle2 size={20} />
                              </div>
                              
                              <div className="flex items-start justify-between pr-8">
                                <div className="space-y-1">
                                  <h3 className="font-bold text-gray-900">{task.title}</h3>
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                      <User size={12} />
                                      {isProviderForThisTask ? (task.clientName || 'Cliente') : task.providerName}
                                    </p>
                                    <div className="w-1 h-1 bg-gray-300 rounded-full" />
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                      {task.createdAt?.toDate ? task.createdAt.toDate().toLocaleDateString('pt-BR') : new Date(task.createdAt).toLocaleDateString('pt-BR')}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-gray-50 rounded-2xl space-y-1">
                                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Pagamento</p>
                                  <p className="text-sm font-black text-gray-900">{task.price?.toLocaleString()} Kz</p>
                                </div>
                                <div className="p-3 bg-gray-50 rounded-2xl space-y-1">
                                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Avaliação</p>
                                  {task.rated ? (
                                    <div className="flex items-center gap-1 text-yellow-500">
                                      <Star size={12} fill="currentColor" />
                                      <span className="text-xs font-bold">Avaliado</span>
                                    </div>
                                  ) : (
                                    <p className="text-xs font-bold text-gray-400">Pendente</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                                <button 
                                  onClick={() => {
                                    const otherId = isProviderForThisTask ? task.clientId : task.providerId;
                                    const otherUser: any = {
                                      uid: otherId,
                                      name: isProviderForThisTask ? (task.clientName || 'Cliente') : task.providerName,
                                      photoURL: `https://picsum.photos/seed/${otherId}/200/200`,
                                      role: isProviderForThisTask ? 'client' : 'provider'
                                    };
                                    setSelectedProvider(otherUser);
                                    setSelectedTask(task);
                                    setView('chat');
                                  }}
                                  className="flex items-center gap-2 text-blue-600 text-xs font-bold hover:underline"
                                >
                                  <MessageSquare size={14} />
                                  Ver Histórico de Chat
                                </button>
                                
                                {!isProviderForThisTask && !task.rated && (
                                  <button 
                                    onClick={() => {
                                      setTaskToRate(task);
                                      setIsRatingModalOpen(true);
                                    }}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                                  >
                                    Avaliar Agora
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        });
                      } else {
                        return (
                          <div className="text-center py-12 space-y-4">
                            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-300">
                              <CheckCircle2 size={40} />
                            </div>
                            <div className="space-y-1">
                              <h3 className="font-bold text-gray-900">Nenhum histórico</h3>
                              <p className="text-sm text-gray-500">Suas tarefas concluídas aparecerão aqui.</p>
                            </div>
                          </div>
                        );
                      }
                    })()}
                  </>
                )}
              </div>

              {hasMoreTasks && tasks.length >= tasksLimit && (
                <motion.button 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setTasksLimit(prev => prev + 10)}
                  className="w-full py-4 bg-white border border-gray-100 rounded-2xl text-blue-600 font-bold text-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Plus size={16} />
                  Ver Mais Tarefas
                </motion.button>
              )}
            </motion.div>
          )}

          {view === 'schedules' && (
            <motion.div 
              key="schedules"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-6"
            >
              <div className="flex items-center gap-4 mb-6">
                <button 
                  onClick={() => setView('dashboard')}
                  className="p-2 bg-white rounded-full shadow-sm text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Agendamentos</h2>
              </div>

              <div className="space-y-4">
                {(() => {
                  const scheduledTasks = [...tasks, ...providerTasks]
                    .filter(t => t.scheduledAt)
                    .sort((a, b) => {
                      const dateA = a.scheduledAt.toDate ? a.scheduledAt.toDate() : new Date(a.scheduledAt);
                      const dateB = b.scheduledAt.toDate ? b.scheduledAt.toDate() : new Date(b.scheduledAt);
                      return dateA.getTime() - dateB.getTime();
                    });

                  if (scheduledTasks.length > 0) {
                    return scheduledTasks.map((task) => {
                      const isProviderForThisTask = task.providerId === user?.uid;
                      const scheduledDate = task.scheduledAt.toDate ? task.scheduledAt.toDate() : new Date(task.scheduledAt);
                      
                      return (
                        <div key={task.id} className="bg-white rounded-3xl p-5 border border-blue-100 shadow-sm space-y-4 relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-1 h-full bg-blue-600"></div>
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-blue-600 mb-1">
                                <Calendar size={14} />
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                  {scheduledDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                                </span>
                              </div>
                              <h3 className="font-bold text-gray-900 text-lg">{task.title}</h3>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                  <Clock size={12} />
                                  {scheduledDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </p>
                                <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                                <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                                  <User size={12} />
                                  {isProviderForThisTask ? (task.clientName || 'Cliente') : task.providerName}
                                </p>
                              </div>
                            </div>
                            <div className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                              task.status === 'accepted' ? "bg-blue-100 text-blue-600" :
                              task.status === 'completed' ? "bg-green-100 text-green-600" :
                              "bg-gray-100 text-gray-600"
                            )}>
                              {task.status === 'accepted' ? 'Confirmado' : 
                               task.status === 'completed' ? 'Concluído' : 'Pendente'}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => {
                                  const otherId = isProviderForThisTask ? task.clientId : task.providerId;
                                  const otherUser: any = {
                                    uid: otherId,
                                    name: isProviderForThisTask ? (task.clientName || 'Cliente') : task.providerName,
                                    photoURL: `https://picsum.photos/seed/${otherId}/200/200`,
                                    role: isProviderForThisTask ? 'client' : 'provider'
                                  };
                                  setSelectedProvider(otherUser);
                                  setSelectedTask(task);
                                  setView('chat');
                                }}
                                className="p-2 bg-gray-50 text-gray-600 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-colors"
                              >
                                <MessageSquare size={18} />
                              </button>
                              <button 
                                className="p-2 bg-gray-50 text-gray-600 rounded-xl hover:bg-blue-50 hover:text-blue-600 transition-colors"
                              >
                                <MapPin size={18} />
                              </button>
                            </div>
                            {isProviderForThisTask && task.status === 'pending' && (
                              <button 
                                onClick={async () => {
                                  await updateDoc(doc(db, 'tasks', task.id), { status: 'accepted' });
                                  toast.success('Agendamento confirmado!');
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                              >
                                Confirmar
                              </button>
                            )}
                            {!isProviderForThisTask && task.status === 'accepted' && (
                              <button 
                                onClick={() => completeTask(task)}
                                className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-100"
                              >
                                Concluir
                              </button>
                            )}
                            {!isProviderForThisTask && task.status === 'completed' && !task.rated && (
                              <button 
                                onClick={() => {
                                  setTaskToRate(task);
                                  setIsRatingModalOpen(true);
                                }}
                                className="px-4 py-2 bg-yellow-500 text-white rounded-xl text-xs font-bold hover:bg-yellow-600 transition-colors shadow-lg shadow-yellow-100"
                              >
                                Avaliar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  } else {
                    return (
                      <div className="text-center py-12 space-y-4">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-300">
                          <Calendar size={40} />
                        </div>
                        <div className="space-y-1">
                          <h3 className="font-bold text-gray-900">Nenhum agendamento</h3>
                          <p className="text-sm text-gray-500">Você ainda não possui compromissos marcados.</p>
                        </div>
                      </div>
                    );
                  }
                })()}
              </div>
            </motion.div>
          )}

          {view === 'chat' && selectedProvider && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col h-[calc(100vh-140px)]"
            >
              <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                <button onClick={() => { setView('profile'); setSelectedTask(null); }} className="p-2 hover:bg-white rounded-full">
                  <ArrowLeft size={24} />
                </button>
                <div className="relative">
                  <img src={selectedProvider.photoURL} alt={selectedProvider.name} className="w-10 h-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                  <UserStatusIndicator uid={selectedProvider.uid} className="absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2" dotOnly />
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight">{selectedProvider.name}</h3>
                  <div className="flex items-center gap-2">
                    <UserStatusIndicator uid={selectedProvider.uid} showText textClassName="text-[9px]" />
                    {offlineMessages.some(m => m.chatId === [user?.uid, selectedProvider.uid].sort().join('_')) && (
                      <span className="text-[10px] text-orange-500 font-bold uppercase tracking-widest flex items-center gap-1 animate-pulse">
                        <Clock size={10} />
                        Sincronizando...
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {selectedTask && (
                <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-blue-600" />
                    <span className="text-[10px] font-bold text-blue-900 truncate max-w-[150px]">
                      Discussão: {selectedTask.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedTask.status === 'accepted' && selectedTask.clientId === user?.uid && (
                      <button 
                        onClick={() => completeTask(selectedTask)}
                        className="px-3 py-1 bg-green-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-green-700 transition-colors"
                      >
                        Concluir
                      </button>
                    )}
                    {selectedTask.status === 'completed' && !selectedTask.rated && selectedTask.clientId === user?.uid && (
                      <button 
                        onClick={() => {
                          setTaskToRate(selectedTask);
                          setIsRatingModalOpen(true);
                        }}
                        className="px-3 py-1 bg-yellow-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-yellow-600 transition-colors"
                      >
                        Avaliar
                      </button>
                    )}
                    <button 
                      onClick={() => setSelectedTask(null)}
                      className="text-[10px] font-black text-blue-600 uppercase tracking-widest"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Inicie a conversa enviando uma mensagem ou proposta.
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={cn("flex", msg.senderId === user?.uid ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[85%] p-3 rounded-2xl shadow-sm relative transition-all duration-300",
                        msg.type === 'proposal' && msg.proposalStatus === 'rejected'
                          ? "bg-red-600 text-white"
                          : msg.senderId === user?.uid 
                            ? "bg-blue-600 text-white rounded-tr-none" 
                            : "bg-white border border-gray-100 text-gray-900 rounded-tl-none",
                        msg.isOffline && "opacity-70"
                      )}>
                        {msg.isOffline && (
                          <div className="absolute -top-2 -right-2 bg-orange-500 text-white p-1 rounded-full animate-pulse shadow-lg">
                            <Clock size={10} />
                          </div>
                        )}
                        {msg.type === 'proposal' ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 font-bold">
                              <CreditCard size={16} />
                              Proposta de Preço
                            </div>
                            <div className="text-2xl font-black">{msg.price?.toLocaleString()} Kz</div>
                            
                            {msg.proposalStatus === 'accepted' ? (
                              <div className="text-xs font-bold px-2 py-1 rounded-lg inline-block bg-green-100 text-green-700">
                                ✓ Aceita
                              </div>
                            ) : (
                              msg.senderId !== user?.uid ? (
                                <div className="flex gap-2 pt-2">
                                  <motion.button 
                                    whileHover={msg.proposalStatus === 'pending' ? { scale: 1.02 } : {}}
                                    whileTap={msg.proposalStatus === 'pending' ? { scale: 0.95 } : {}}
                                    onClick={() => msg.proposalStatus === 'pending' && handleProposalAction(msg, 'accepted')}
                                    disabled={msg.proposalStatus === 'rejected'}
                                    className={cn(
                                      "flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5",
                                      msg.proposalStatus === 'rejected'
                                        ? "bg-white/20 text-white/40 cursor-not-allowed"
                                        : "bg-green-500 text-white hover:bg-green-600 shadow-sm"
                                    )}
                                  >
                                    <Check size={14} />
                                    Aceitar
                                  </motion.button>
                                  <motion.button 
                                    whileHover={msg.proposalStatus === 'pending' ? { scale: 1.02 } : {}}
                                    whileTap={msg.proposalStatus === 'pending' ? { scale: 0.95 } : {}}
                                    onClick={() => msg.proposalStatus === 'pending' && handleProposalAction(msg, 'rejected')}
                                    disabled={msg.proposalStatus === 'rejected'}
                                    className={cn(
                                      "flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5",
                                      msg.proposalStatus === 'rejected'
                                        ? "bg-white/20 text-white/40 cursor-not-allowed"
                                        : "bg-red-500 text-white hover:bg-red-600 shadow-sm"
                                    )}
                                  >
                                    <X size={14} />
                                    Recusar
                                  </motion.button>
                                </div>
                              ) : (
                                <div className="text-[10px] opacity-70 font-bold uppercase tracking-widest">
                                  {msg.proposalStatus === 'rejected' ? 'Proposta Recusada' : 'Aguardando resposta...'}
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <p className="text-sm">{msg.text}</p>
                        )}
                        
                        {msg.isOffline && msg.senderId === user?.uid && (
                          <div className="absolute -left-6 bottom-1 text-gray-400 animate-pulse">
                            <Clock size={12} />
                          </div>
                        )}
                        
                        <div className={cn(
                          "text-[8px] mt-1 opacity-50 font-bold uppercase tracking-widest text-right",
                          msg.senderId === user?.uid ? "text-white" : "text-gray-500"
                        )}>
                          {msg.createdAt?.seconds 
                            ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 bg-white border-t border-gray-100">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Digite sua mensagem..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95, boxShadow: "0 0 20px rgba(37, 99, 235, 0.3)" }}
                    onClick={() => sendMessage()}
                    className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                  >
                    <Send size={20} />
                  </motion.button>
                </div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  <button 
                    onClick={() => setIsProposalModalOpen(true)}
                    className="whitespace-nowrap px-4 py-2 bg-green-50 text-green-600 border border-green-100 rounded-full text-xs font-bold flex items-center gap-2 hover:bg-green-100 transition-colors"
                  >
                    <CreditCard size={14} />
                    Enviar Proposta de Preço
                  </button>
                </div>
              </div>

              {/* Proposal Modal */}
              <AnimatePresence>
                {isProposalModalOpen && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsProposalModalOpen(false)}
                      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-xs bg-white rounded-3xl p-6 z-50 shadow-2xl space-y-6"
                    >
                      <div className="text-center space-y-2">
                        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
                          <CreditCard size={24} />
                        </div>
                        <h3 className="text-xl font-bold">Enviar Proposta</h3>
                        <p className="text-sm text-gray-500">Defina o valor para este serviço.</p>
                      </div>

                      <div className="relative">
                        <input 
                          type="number" 
                          placeholder="0"
                          value={proposalPrice}
                          onChange={(e) => {
                            setProposalPrice(e.target.value);
                            if (proposalError) setProposalError('');
                          }}
                          className={cn(
                            "w-full text-center text-3xl font-black py-4 bg-gray-50 border rounded-2xl focus:ring-2 outline-none transition-all",
                            proposalError 
                              ? "border-red-300 focus:ring-red-500 text-red-600" 
                              : "border-gray-200 focus:ring-blue-500 text-gray-900"
                          )}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">Kz</span>
                      </div>

                      {proposalError && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-center gap-2 text-red-500 bg-red-50 p-3 rounded-xl border border-red-100"
                        >
                          <AlertCircle size={16} />
                          <span className="text-xs font-bold">{proposalError}</span>
                        </motion.div>
                      )}

                      <div className="flex gap-3">
                        <button 
                          onClick={() => {
                            setIsProposalModalOpen(false);
                            setProposalError('');
                          }}
                          className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button 
                          onClick={() => {
                            const price = Number(proposalPrice);
                            if (!proposalPrice || isNaN(price)) {
                              setProposalError('Por favor, insira um valor válido.');
                              return;
                            }
                            if (price <= 0) {
                              setProposalError('O preço deve ser maior que zero.');
                              return;
                            }
                            sendMessage('proposal', price);
                            setProposalError('');
                          }}
                          className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                        >
                          Enviar
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {view === 'payment' && (
            <motion.div 
              key="payment"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="p-4 space-y-6"
            >
              <div className="flex items-center gap-4 mb-6">
                <button onClick={() => {
                  setView('chat');
                  setAppliedCoupon(null);
                  setCouponCode('');
                }} className="p-2 hover:bg-white rounded-full transition-colors">
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-xl font-bold">Pagamento Seguro</h2>
              </div>

              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-lg space-y-6">
                <div className="text-center space-y-2">
                  <span className="text-sm text-gray-500 font-medium">Valor acordado</span>
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      "text-4xl font-black text-gray-900",
                      appliedCoupon && "text-sm text-gray-400 line-through"
                    )}>
                      {acceptedPrice ? acceptedPrice.toLocaleString() : '15.000'} Kz
                    </div>
                    {appliedCoupon && (
                      <div className="text-4xl font-black text-green-600">
                        {Math.round((acceptedPrice || 15000) * (1 - appliedCoupon.discount)).toLocaleString()} Kz
                      </div>
                    )}
                  </div>
                </div>

                {/* Coupon Section */}
                <div className="space-y-3 pt-4 border-t border-gray-50">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cupom de Desconto</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Código do cupom"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-blue-500"
                    />
                    <button 
                      onClick={applyCoupon}
                      className="px-4 py-3 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-colors"
                    >
                      Aplicar
                    </button>
                  </div>
                  {appliedCoupon && (
                    <div className="flex items-center justify-between p-3 bg-green-50 border border-green-100 rounded-xl">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-green-600" />
                        <span className="text-xs font-bold text-green-700">{appliedCoupon.code}</span>
                      </div>
                      <button 
                        onClick={() => setAppliedCoupon(null)}
                        className="text-[10px] font-bold text-red-500 hover:underline"
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-gray-900">Escolha o método</h3>
                  <div className="grid grid-cols-1 gap-3">
                    <button className="p-4 border-2 border-blue-600 bg-blue-50 rounded-2xl flex items-center justify-between group">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-blue-600 shadow-sm">
                          <CreditCard size={24} />
                        </div>
                        <div className="text-left">
                          <span className="block font-bold text-gray-900">Multicaixa Express</span>
                          <span className="text-xs text-gray-500">Angola</span>
                        </div>
                      </div>
                      <div className="w-6 h-6 rounded-full border-2 border-blue-600 flex items-center justify-center">
                        <div className="w-3 h-3 bg-blue-600 rounded-full" />
                      </div>
                    </button>
                    <button className="p-4 border-2 border-gray-100 rounded-2xl flex items-center justify-between hover:border-blue-200 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-red-600 shadow-sm">
                          <Plus size={24} />
                        </div>
                        <div className="text-left">
                          <span className="block font-bold text-gray-900">M-Pesa</span>
                          <span className="text-xs text-gray-500">Moçambique</span>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98, boxShadow: "0 0 30px rgba(37, 99, 235, 0.5)" }}
                  onClick={() => {
                    alert('Pagamento processado com sucesso! O valor ficará retido até a conclusão do serviço.');
                    setView('home');
                    setAppliedCoupon(null);
                    setCouponCode('');
                  }}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                >
                  Confirmar Pagamento
                </motion.button>
                
                <p className="text-[10px] text-center text-gray-400 uppercase tracking-widest font-bold">
                  Protegido por MatchTask Escrow
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Share Modal */}
      <AnimatePresence>
        {isShareModalOpen && selectedProvider && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsShareModalOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-[32px] shadow-2xl overflow-hidden z-[160]"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black text-gray-900 tracking-tight">Compartilhar Perfil</h3>
                  <button 
                    onClick={() => setIsShareModalOpen(false)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X size={20} className="text-gray-400" />
                  </button>
                </div>

                <div className="flex flex-col items-center gap-4 py-4">
                  <img 
                    src={selectedProvider.photoURL} 
                    alt={selectedProvider.name} 
                    className="w-20 h-20 rounded-2xl object-cover shadow-lg"
                    referrerPolicy="no-referrer"
                  />
                  <div className="text-center">
                    <p className="font-bold text-gray-900">{selectedProvider.name}</p>
                    <p className="text-xs text-gray-500">{selectedProvider.skills?.[0] || 'Profissional'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <button 
                    onClick={() => {
                      const url = `https://wa.me/?text=Confira o perfil de ${selectedProvider.name} no MatchTask: ${window.location.href}`;
                      window.open(url, '_blank');
                    }}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-all">
                      <MessageSquare size={20} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">WhatsApp</span>
                  </button>
                  <button 
                    onClick={() => {
                      const url = `https://www.facebook.com/sharer/sharer.php?u=${window.location.href}`;
                      window.open(url, '_blank');
                    }}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all">
                      <Facebook size={20} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Facebook</span>
                  </button>
                  <button 
                    onClick={() => {
                      const url = `https://twitter.com/intent/tweet?text=Confira o perfil de ${selectedProvider.name} no MatchTask&url=${window.location.href}`;
                      window.open(url, '_blank');
                    }}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-12 h-12 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center group-hover:bg-sky-600 group-hover:text-white transition-all">
                      <Twitter size={20} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Twitter</span>
                  </button>
                  <button 
                    onClick={() => {
                      const url = `https://www.linkedin.com/sharing/share-offsite/?url=${window.location.href}`;
                      window.open(url, '_blank');
                    }}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      <Linkedin size={20} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">LinkedIn</span>
                  </button>
                </div>

                <div className="pt-4">
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <input 
                      type="text" 
                      readOnly 
                      value={window.location.href}
                      className="flex-1 bg-transparent text-[10px] text-gray-500 outline-none overflow-hidden text-ellipsis"
                    />
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.href);
                        toast.success('Link copiado!');
                      }}
                      className="p-2 bg-white text-blue-600 rounded-xl shadow-sm hover:bg-blue-50 transition-colors"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Job Posting Modal */}
      <AnimatePresence>
        {isJobModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsJobModalOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-sm bg-white rounded-[32px] p-8 z-[110] shadow-2xl space-y-6"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <Briefcase size={32} />
                </div>
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Publicar Oferta</h3>
                <p className="text-sm text-gray-500 font-medium">Descreva o serviço que você precisa.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Título</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Pintura de Sala"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Categoria</label>
                  <select 
                    value={jobCategory}
                    onChange={(e) => setJobCategory(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium appearance-none"
                  >
                    <option value="">Selecione uma categoria</option>
                    {CATEGORIES.map(cat => (
                      <option key={cat.name} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Descrição</label>
                  <textarea 
                    placeholder="Detalhes sobre o trabalho..."
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none min-h-[100px] text-sm font-medium"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setIsJobModalOpen(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={postJob}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  Publicar
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Job Modal */}
      <AnimatePresence>
        {isJobModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsJobModalOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-[32px] p-8 z-[110] shadow-2xl space-y-6 max-w-md mx-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Publicar Oferta</h3>
                <button onClick={() => setIsJobModalOpen(false)} className="p-2 bg-gray-100 rounded-full text-gray-500">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Título do Serviço</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Preciso de um Pintor para Sala"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Categoria</label>
                  <select 
                    value={jobCategory}
                    onChange={(e) => setJobCategory(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium appearance-none"
                  >
                    <option value="">Selecione uma categoria</option>
                    {CATEGORIES.map(cat => (
                      <option key={cat.name} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Descrição Detalhada</label>
                  <textarea 
                    placeholder="Descreva o que você precisa, prazo e detalhes importantes..."
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none min-h-[120px] text-sm font-medium"
                  />
                </div>
              </div>

              <button 
                onClick={publishJob}
                disabled={isPublishingJob}
                className={cn(
                  "w-full py-4 rounded-2xl font-black text-lg transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-2",
                  isPublishingJob 
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed shadow-none" 
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100"
                )}
              >
                {isPublishingJob ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Publicando...
                  </>
                ) : (
                  'Publicar Oferta Agora'
                )}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Rating Modal */}
      <AnimatePresence>
        {isRatingModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsRatingModalOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-sm bg-white rounded-[32px] p-8 z-[110] shadow-2xl space-y-8"
            >
              <div className="text-center space-y-3">
                <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <Star size={32} fill="currentColor" />
                </div>
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Avaliar Serviço</h3>
                <p className="text-sm text-gray-500 font-medium">Como foi sua experiência com {taskToRate?.providerName}?</p>
              </div>

              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button 
                    key={star}
                    onClick={() => setRatingValue(star)}
                    className="p-1 transition-transform active:scale-90"
                  >
                    <Star 
                      size={36} 
                      className={cn(
                        "transition-colors",
                        star <= ratingValue ? "text-yellow-400 fill-yellow-400" : "text-gray-200"
                      )} 
                    />
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Comentário (Opcional)</label>
                <textarea 
                  placeholder="Conte-nos o que achou do serviço..."
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none min-h-[100px] text-sm font-medium"
                />
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsRatingModalOpen(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Pular
                </button>
                <button 
                  onClick={submitRating}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  Enviar Avaliação
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Photo Source Modal */}
      <AnimatePresence>
        {isPhotoModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isCameraActive) setIsPhotoModalOpen(false);
              }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed inset-x-4 top-[10%] bottom-[10%] md:inset-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-md bg-white rounded-[2.5rem] shadow-2xl z-[80] overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-black text-gray-900 tracking-tight">Atualizar Foto de Perfil</h3>
                <button 
                  onClick={() => {
                    stopCamera();
                    setIsPhotoModalOpen(false);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
                {!isCameraActive ? (
                  <>
                    <button 
                      onClick={startCamera}
                      className="w-full p-8 bg-blue-50 border-2 border-dashed border-blue-200 rounded-3xl flex flex-col items-center gap-4 hover:bg-blue-100 transition-colors group"
                    >
                      <div className="p-4 bg-blue-600 text-white rounded-2xl shadow-lg group-hover:scale-110 transition-transform">
                        <Camera size={32} />
                      </div>
                      <div className="text-center">
                        <span className="block text-lg font-black text-gray-900">Usar Câmera</span>
                        <span className="text-sm text-gray-500 font-medium">Tire uma foto agora</span>
                      </div>
                    </button>

                    <label className="w-full p-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center gap-4 hover:bg-gray-100 transition-colors group cursor-pointer text-center">
                      <div className="p-4 bg-gray-900 text-white rounded-2xl shadow-lg group-hover:scale-110 transition-transform flex items-center justify-center mx-auto mb-2">
                        <Plus size={32} />
                      </div>
                      <div className="text-center">
                        <span className="block text-lg font-black text-gray-900">Selecionar do Dispositivo</span>
                        <span className="text-sm text-gray-500 font-medium">Escolha uma foto da galeria</span>
                      </div>
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleProfileImageChange} 
                        className="hidden" 
                      />
                    </label>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col gap-6">
                    <div className="relative aspect-square rounded-[2rem] overflow-hidden bg-black shadow-inner border-4 border-white">
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted
                        className="w-full h-full object-cover transform scale-x-[-1]"
                      />
                      <div className="absolute inset-0 border-2 border-white/20 pointer-events-none rounded-[2rem]" />
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={stopCamera}
                        className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-lg hover:bg-gray-200 transition-all"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={capturePhoto}
                        disabled={isUploadingImage}
                        className="flex-3 py-4 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2 active:scale-95"
                      >
                        {isUploadingImage ? (
                          <>
                            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Enviando...
                          </>
                        ) : (
                          <>
                            <Camera size={24} />
                            Tirar Foto
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} className="hidden" />

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-black/80 backdrop-blur-md border-t border-gray-100 dark:border-white/10 px-6 py-3 flex items-center justify-between z-40 max-w-md mx-auto">
        {[
          { id: 'home', icon: Home, label: t('home') },
          { id: 'tasks', icon: Briefcase, label: t('tasks') },
          { id: 'favorites', icon: Heart, label: t('favorites') },
          { id: 'chats', icon: MessageSquare, label: t('chats') },
          { id: 'profile', icon: User, label: t('profile') }
        ].map((item) => {
          const isActive = view === item.id || (item.id === 'profile' && view === 'profile' && selectedProvider?.uid === user?.uid);
          return (
            <button 
              key={item.id}
              onClick={() => {
                if (item.id === 'home') {
                  setView('home');
                  setSelectedProvider(null);
                } else if (item.id === 'tasks') {
                  setView('tasks');
                } else if (item.id === 'favorites') {
                  setView('favorites');
                } else if (item.id === 'chats') {
                  setView('chats');
                } else if (item.id === 'profile') {
                  if (user) {
                    const myProfile = {
                      uid: user.uid,
                      name: user.displayName || t('profile'),
                      photoURL: user.photoURL || 'https://picsum.photos/seed/user/200/200',
                      role: userRole,
                      bio: '...',
                      skills: userRole === 'provider' ? ['Geral'] : []
                    } as any;
                    setSelectedProvider(myProfile);
                    setView('profile');
                  } else {
                    handleLogin();
                  }
                }
              }}
              className="relative flex flex-col items-center gap-1 min-w-[64px]"
            >
              <motion.div
                animate={{ 
                  scale: isActive ? 1.2 : 1,
                  y: isActive ? -4 : 0,
                  color: isActive ? '#2563eb' : (theme === 'dark' ? '#6b7280' : '#4b5563')
                }}
                className="transition-colors"
              >
                <item.icon size={24} fill={isActive && item.id === 'favorites' ? "currentColor" : "none"} />
              </motion.div>
              <span className={cn(
                "text-[10px] font-black uppercase tracking-wider transition-colors",
                isActive ? "text-blue-600" : "text-gray-500 dark:text-gray-400"
              )}>
                {item.label}
              </span>
              {isActive && (
                <motion.div 
                  layoutId="bottom-nav-indicator"
                  className="absolute -top-3 w-8 h-1 bg-blue-600 rounded-full shadow-[0_-2px_10px_rgba(37,99,235,0.3)]"
                  transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Menu Overlay */}
      <AnimatePresence>
        {isMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-72 bg-white dark:bg-[#121212] z-50 shadow-2xl p-6 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">Menu</h3>
                <button onClick={() => setIsMenuOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full text-gray-500 dark:text-white transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto pr-2 custom-scrollbar">
                {[
                  { id: 'home', icon: Home, label: t('home'), color: 'text-blue-600', onClick: () => setView('home') },
                  { id: 'profile', icon: User, label: t('profile'), color: 'text-blue-600', onClick: () => {
                    if (user) {
                      const myProfile = {
                        uid: user.uid,
                        name: user.displayName || t('profile'),
                        photoURL: user.photoURL || 'https://picsum.photos/seed/user/200/200',
                        role: userRole,
                        bio: '...',
                        skills: userRole === 'provider' ? ['Geral'] : []
                      } as any;
                      setSelectedProvider(myProfile);
                      setView('profile');
                    }
                  }},
                  { id: 'chats', icon: MessageSquare, label: t('chats'), color: 'text-blue-600', onClick: () => setView('chats') },
                  { id: 'favorites', icon: Heart, label: t('favorites'), color: 'text-red-500', onClick: () => setView('favorites') },
                  { id: 'schedules', icon: Calendar, label: t('schedules'), color: 'text-blue-600', onClick: () => setView('schedules') },
                  ...(userRole === 'provider' ? [
                    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', color: 'text-green-600', onClick: () => setView('dashboard') },
                    { id: 'job_offers', icon: Zap, label: 'Ofertas de Serviço', color: 'text-yellow-500', onClick: () => setView('job_offers') }
                  ] : []),
                  { id: 'tasks', icon: CheckCircle2, label: t('myTasks'), color: 'text-green-600', onClick: () => setView('tasks') },
                  { id: 'settings', icon: Settings, label: t('settings'), color: 'text-blue-600', onClick: () => {
                    if (user) {
                      const myProfile: any = {
                        uid: user.uid,
                        name: user.displayName || t('profile'),
                        photoURL: user.photoURL || 'https://picsum.photos/seed/user/200/200',
                        role: userRole,
                        bio: '...',
                        skills: userRole === 'provider' ? ['Geral'] : []
                      };
                      setSelectedProvider(myProfile);
                      setView('profile');
                      setTimeout(() => {
                        const settingsEl = document.getElementById('notification-settings');
                        if (settingsEl) settingsEl.scrollIntoView({ behavior: 'smooth' });
                      }, 400);
                    }
                  }}
                ].map((item, index) => (
                  <motion.button 
                    key={item.id}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.04, type: "spring", damping: 20 }}
                    onClick={() => {
                      item.onClick();
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 p-3.5 hover:bg-gray-50 dark:hover:bg-white/5 rounded-2xl transition-all text-left group"
                  >
                    <div className={cn("p-2 rounded-xl bg-gray-50 dark:bg-white/5 group-hover:scale-110 transition-all", item.color.replace('text-', 'bg-').replace('600', '500/10'))}>
                      <item.icon size={20} className={cn(item.color)} />
                    </div>
                    <span className="font-bold text-gray-900 dark:text-white text-sm">{item.label}</span>
                  </motion.button>
                ))}
                
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="mt-6 pt-6 border-t border-gray-100 dark:border-white/10 space-y-3"
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                       <Moon size={18} className="text-gray-400" />
                       <span className="text-sm font-bold text-gray-700 dark:text-white">{t('theme')}</span>
                    </div>
                    <button 
                      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                      className="w-12 h-6 bg-gray-100 dark:bg-blue-600 rounded-full relative transition-colors shadow-inner"
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all flex items-center justify-center shadow-sm",
                        theme === 'dark' ? "left-7" : "left-1"
                      )}>
                        {theme === 'dark' ? <Moon size={10} className="text-blue-600" /> : <Sun size={10} className="text-orange-400" />}
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                       <Globe size={18} className="text-gray-400" />
                       <span className="text-sm font-bold text-gray-700 dark:text-white">{t('language')}</span>
                    </div>
                    <button 
                      onClick={() => setLanguage(language === 'pt' ? 'en' : 'pt')}
                      className="px-3 py-1.5 bg-gray-100 dark:bg-white/5 text-gray-900 dark:text-white rounded-lg text-[10px] font-black uppercase tracking-widest border border-gray-200 dark:border-white/10 hover:border-blue-200 transition-colors"
                    >
                      {language === 'pt' ? 'Português' : 'English'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Shield size={18} className="text-gray-400" />
                      <span className="text-sm font-bold text-gray-700 dark:text-white">Modo Prestador</span>
                    </div>
                    <button 
                      onClick={() => setUserRole(userRole === 'client' ? 'provider' : 'client')}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative shadow-inner",
                        userRole === 'provider' ? "bg-blue-600" : "bg-gray-200 dark:bg-white/10"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                        userRole === 'provider' ? "right-1" : "left-1"
                      )} />
                    </button>
                  </div>

                  <button 
                    onClick={() => {
                      signOut(auth);
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 p-4 text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-2xl transition-all text-left mt-4 border border-transparent hover:border-red-100 dark:hover:border-red-500/20"
                  >
                    <LogOut size={20} />
                    <span className="font-black text-xs uppercase tracking-widest">{t('logout')}</span>
                  </button>
                </motion.div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Full Screen Portfolio Viewer */}
      <AnimatePresence>
        {selectedPortfolioImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-4"
          >
            <motion.button 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={() => setSelectedPortfolioImage(null)}
              className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl transition-colors z-10"
            >
              <X size={32} />
            </motion.button>

            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="max-w-5xl w-full space-y-6"
            >
              <div className="relative rounded-[32px] overflow-hidden shadow-2xl border border-white/10">
                <img 
                  src={selectedPortfolioImage.imageURL} 
                  alt={selectedPortfolioImage.title} 
                  className="w-full h-auto max-h-[70vh] object-contain bg-black/20"
                  referrerPolicy="no-referrer"
                />
              </div>
              
              <div className="text-center space-y-2">
                <motion.h2 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-3xl font-black text-white tracking-tight"
                >
                  {selectedPortfolioImage.title}
                </motion.h2>
                <motion.p 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-gray-400 max-w-2xl mx-auto text-lg font-medium"
                >
                  {selectedPortfolioImage.description}
                </motion.p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
