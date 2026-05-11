import React, { useEffect, useState } from 'react';

function AgentThinking({ isVisible, messages = ['Analyzing...', 'Processing...', 'Almost ready...'] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isVisible) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, 1500);
    return () => clearInterval(timer);
  }, [isVisible, messages]);

  if (!isVisible) return null;

  return (
    <div className="bg-[#1E293B]/95 rounded-2xl p-6 border border-[#334155] shadow-xl">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-indigo-600/20 text-2xl flex items-center justify-center animate-pulse">
          🧠
        </div>
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-300">Agent Thinking</p>
          <p className="text-xl font-semibold text-white">{messages[index]}</p>
        </div>
      </div>
    </div>
  );
}

export default AgentThinking;
