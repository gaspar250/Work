import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { X, RefreshCw, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

interface SudokuGameProps {
  onClose: () => void;
}

const INITIAL_PUZZLE = [
  [5, 3, 0, 0, 7, 0, 0, 0, 0],
  [6, 0, 0, 1, 9, 5, 0, 0, 0],
  [0, 9, 8, 0, 0, 0, 0, 6, 0],
  [8, 0, 0, 0, 6, 0, 0, 0, 3],
  [4, 0, 0, 8, 0, 3, 0, 0, 1],
  [7, 0, 0, 0, 2, 0, 0, 0, 6],
  [0, 6, 0, 0, 0, 0, 2, 8, 0],
  [0, 0, 0, 4, 1, 9, 0, 0, 5],
  [0, 0, 0, 0, 8, 0, 0, 7, 9]
];

export const SudokuGame: React.FC<SudokuGameProps> = ({ onClose }) => {
  const [board, setBoard] = useState<number[][]>(INITIAL_PUZZLE.map(row => [...row]));
  const [showErrors, setShowErrors] = useState(false);
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const checkErrors = useCallback((currentBoard: number[][]) => {
    const newErrors = new Set<string>();
    
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = currentBoard[r][c];
        if (val === 0) continue;

        // Check row
        for (let i = 0; i < 9; i++) {
          if (i !== c && currentBoard[r][i] === val) {
            newErrors.add(`${r}-${c}`);
            newErrors.add(`${r}-${i}`);
          }
        }

        // Check column
        for (let i = 0; i < 9; i++) {
          if (i !== r && currentBoard[i][c] === val) {
            newErrors.add(`${r}-${c}`);
            newErrors.add(`${i}-${c}`);
          }
        }

        // Check 3x3 box
        const startRow = Math.floor(r / 3) * 3;
        const startCol = Math.floor(c / 3) * 3;
        for (let i = startRow; i < startRow + 3; i++) {
          for (let j = startCol; j < startCol + 3; j++) {
            if ((i !== r || j !== c) && currentBoard[i][j] === val) {
              newErrors.add(`${r}-${c}`);
              newErrors.add(`${i}-${j}`);
            }
          }
        }
      }
    }
    setErrors(newErrors);
  }, []);

  useEffect(() => {
    checkErrors(board);
  }, [board, checkErrors]);

  const handleCellClick = (r: number, c: number) => {
    if (INITIAL_PUZZLE[r][c] !== 0) return;
    setSelectedCell([r, c]);
  };

  const handleNumberInput = (num: number) => {
    if (!selectedCell) return;
    const [r, c] = selectedCell;
    const newBoard = board.map(row => [...row]);
    newBoard[r][c] = num === newBoard[r][c] ? 0 : num;
    setBoard(newBoard);
  };

  const resetGame = () => {
    setBoard(INITIAL_PUZZLE.map(row => [...row]));
    setSelectedCell(null);
  };

  const isComplete = board.every(row => row.every(cell => cell !== 0)) && errors.size === 0;

  return (
    <div className="flex flex-col items-center space-y-6 p-4 bg-white rounded-3xl shadow-xl max-w-md mx-auto">
      <div className="flex items-center justify-between w-full">
        <h2 className="text-xl font-black text-gray-900">Sudoku Relax</h2>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <X size={24} />
        </button>
      </div>

      <div className="flex items-center justify-between w-full px-2">
        <button 
          onClick={() => setShowErrors(!showErrors)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
            showErrors ? "bg-red-100 text-red-600 shadow-inner" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          )}
        >
          {showErrors ? <Eye size={16} /> : <EyeOff size={16} />}
          {showErrors ? "Erros Visíveis" : "Mostrar Erros"}
        </button>
        <button 
          onClick={resetGame}
          className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-blue-100 transition-all"
        >
          <RefreshCw size={16} />
          Reiniciar
        </button>
      </div>

      <div className="grid grid-cols-9 gap-0.5 bg-gray-300 p-0.5 rounded-lg overflow-hidden border-2 border-gray-800">
        {board.map((row, r) => (
          row.map((cell, c) => {
            const isInitial = INITIAL_PUZZLE[r][c] !== 0;
            const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
            const hasError = showErrors && errors.has(`${r}-${c}`);
            
            // Determine box borders
            const borderRight = (c + 1) % 3 === 0 && c < 8 ? 'border-r-2 border-gray-800' : '';
            const borderBottom = (r + 1) % 3 === 0 && r < 8 ? 'border-b-2 border-gray-800' : '';

            return (
              <div 
                key={`${r}-${c}`}
                onClick={() => handleCellClick(r, c)}
                className={cn(
                  "w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center text-sm sm:text-base font-bold cursor-pointer transition-all",
                  isInitial ? "bg-gray-100 text-gray-900" : "bg-white text-blue-600",
                  isSelected && "bg-blue-100 ring-2 ring-blue-500 z-10",
                  hasError && "bg-red-100 text-red-600",
                  !isSelected && !hasError && !isInitial && "hover:bg-blue-50",
                  borderRight,
                  borderBottom
                )}
              >
                {cell !== 0 ? cell : ''}
              </div>
            );
          })
        ))}
      </div>

      <div className="grid grid-cols-5 sm:grid-cols-9 gap-2 w-full">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
          <button
            key={num}
            onClick={() => handleNumberInput(num)}
            className="h-10 bg-gray-100 rounded-xl font-black text-gray-900 hover:bg-blue-600 hover:text-white transition-all active:scale-95"
          >
            {num}
          </button>
        ))}
      </div>

      {isComplete && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-2xl border border-green-100 w-full"
        >
          <CheckCircle2 size={24} />
          <div className="flex-1">
            <p className="font-bold">Parabéns!</p>
            <p className="text-xs">Você resolveu o Sudoku com sucesso.</p>
          </div>
        </motion.div>
      )}

      {showErrors && errors.size > 0 && (
        <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-2xl border border-red-100 w-full">
          <AlertCircle size={24} />
          <div className="flex-1">
            <p className="font-bold">Conflitos Detectados</p>
            <p className="text-xs">Existem números repetidos em linhas, colunas ou blocos.</p>
          </div>
        </div>
      )}
    </div>
  );
};
