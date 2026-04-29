importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCUNvyK-NYUe4hrv1VwOJ1QoueJ6q1Czlc",
  authDomain: "studio-914418244-bbdf6.firebaseapp.com",
  projectId: "studio-914418244-bbdf6",
  storageBucket: "studio-914418244-bbdf6.firebasestorage.app",
  messagingSenderId: "956706517390",
  appId: "1:956706517390:web:ba2690af934a3ca25a74df"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
