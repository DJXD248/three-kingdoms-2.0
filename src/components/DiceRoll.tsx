import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';


export default function DiceRoll() {
  const players = useGameStore(s => s.players);
  const rollDice = useGameStore(s => s.rollDice);
  const assignFactions = useGameStore(s => s.assignFactions);
  const setPhase = useGameStore(s => s.setPhase);
  const [rolling, setRolling] = useState(false);
  const [displayValues, setDisplayValues] = useState<number[]>(players.map(() => 0));
  const [showResults, setShowResults] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const handleRoll = () => {
    setRolling(true);
    let count = 0;
    intervalRef.current = window.setInterval(() => {
      setDisplayValues(players.map(() => Math.floor(Math.random() * 12) + 1));
      count++;
      if (count > 20) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        rollDice();
        setRolling(false);
        setShowResults(true);
      }
    }, 80);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const updatedPlayers = useGameStore(s => s.players);

  useEffect(() => {
    if (showResults) {
      setDisplayValues(updatedPlayers.map(p => p.diceRoll));
    }
  }, [showResults, updatedPlayers]);

  const handleConfirmSeats = () => {
    setPhase('factionAssign');
    assignFactions();
  };

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      <h1 className="text-3xl font-black text-amber-200 mb-2 tracking-wider">🎲 投掷骰子</h1>
      <p className="text-amber-500/60 mb-10">12面骰子决定座次</p>

      <div className="flex gap-8 mb-10">
        {(showResults ? updatedPlayers : players).map((player, i) => (
          <div key={player.id} className="flex flex-col items-center animate-fadeIn">
            <div className={`w-28 h-28 rounded-xl border-2 flex items-center justify-center mb-3 text-4xl font-black transition-all duration-300 ${
              rolling ? 'border-amber-400 bg-amber-900/30 animate-bounce shadow-lg shadow-amber-500/20' : 
              showResults ? 'border-amber-500 bg-amber-900/20' : 'border-amber-700/30 bg-black/40'
            }`}>
              <span className={showResults ? 'text-amber-200' : 'text-amber-400'}>
                {displayValues[i] || '?'}
              </span>
            </div>
            <p className="text-amber-200 font-bold text-lg">{player.name}</p>
            {showResults && (
              <div className="mt-2 flex flex-col items-center animate-fadeIn">
                <p className="text-amber-400 text-sm">🏅 座次: {player.seatOrder + 1}</p>
                <p className="text-amber-500/50 text-xs mt-0.5">掷出 {player.diceRoll} 点</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {!showResults ? (
        <button
          onClick={handleRoll}
          disabled={rolling}
          className={`px-10 py-4 rounded-xl font-black text-xl transition-all tracking-wider ${
            rolling
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/40 hover:scale-105 active:scale-95'
          }`}
        >
          {rolling ? '🎲 投掷中...' : '🎲 投掷骰子'}
        </button>
      ) : (
        <button
          onClick={handleConfirmSeats}
          className="px-10 py-4 rounded-xl font-black text-xl bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/40 hover:scale-105 active:scale-95 transition-all tracking-wider"
        >
          确认座次 → 分配势力
        </button>
      )}
    </div>
  );
}
