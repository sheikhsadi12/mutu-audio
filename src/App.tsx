import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MoreVertical, X, Settings, Play, Download, Trash2, Edit2, 
  Folder, FolderOpen, Save, Merge, CheckSquare, Square,
  Loader2, RadioReceiver, DownloadCloud
} from 'lucide-react';
import { db, AudioItem, base64ToInt16Array, pcmToMp3Blob, downloadBlob, mergeBase64Audios } from './lib/audio';

// API Call helper
async function generateTTS(text: string, voice: string, apiKey: string, model: string) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, apiKey, model })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to generate audio');
  }
  const data = await res.json();
  return data.audio; // base64
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');

  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem('INTRO_SEEN'));
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const [text, setText] = useState('');
  const [scene, setScene] = useState('');
  const [context, setContext] = useState('');
  const [voice, setVoice] = useState('Puck'); // Puck, Charon, Aoede, Kore, Fenrir, Zephyr
  const [model, setModel] = useState('gemini-3.1-flash-tts-preview');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [lastGeneratedId, setLastGeneratedId] = useState<number | null>(null);

  // Audio DB State
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [activeFolder, setActiveFolder] = useState<'recent' | 'merged'>('recent');
  
  // Selection mode for merging
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Edit Name Modal
  const [editItem, setEditItem] = useState<AudioItem | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Dropdown state for items
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);

  // Player state
  const [playingItem, setPlayingItem] = useState<AudioItem | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    loadAudios();
    
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      // Any generic cleanup
    };
  }, []);
  
  useEffect(() => {
    return () => {
      if (audioUrl) {
         URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const loadAudios = async () => {
    const list = await db.audios.orderBy('createdAt').reverse().toArray();
    setAudios(list);
  };

  const handleSaveApiKey = () => {
    localStorage.setItem('GEMINI_API_KEY', apiKey);
    setSettingsOpen(false);
  };

  const handleRun = async () => {
    if (!text.trim()) {
      setErrorMsg("Script cannot be empty.");
      return;
    }
    setErrorMsg('');
    setIsGenerating(true);
    setProgress(0);
    setLastGeneratedId(null);
    
    // Fake progress bar
    const interval = setInterval(() => {
      setProgress(p => Math.min(p + (100 - p) * 0.1, 95));
    }, 200);

    try {
      const fullText = [
        scene ? `Scene: ${scene}.` : '',
        context ? `Context: ${context}.` : '',
        text
      ].filter(Boolean).join('\n');

      const base64Audio = await generateTTS(fullText, voice, apiKey, model);
      
      const newItem: AudioItem = {
        title: `Generation - ${new Date().toLocaleTimeString()}`,
        type: 'recent',
        createdAt: Date.now(),
        audioData: base64Audio
      };
      const newId = await db.audios.add(newItem);
      setLastGeneratedId(Number(newId));
      await loadAudios();
      
      setProgress(100);
    } catch (err: any) {
      setErrorMsg(err.message || 'Generation failed');
    } finally {
      clearInterval(interval);
      setTimeout(() => {
        setIsGenerating(false);
        setProgress(0);
      }, 500);
    }
  };

  const toggleSelection = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleMerge = async () => {
    if (selectedIds.size < 2 || selectedIds.size > 5) {
      setErrorMsg("Select 2 to 5 audios to merge.");
      return;
    }
    setErrorMsg('');
    
    const itemsToMerge = audios
      .filter(a => a.id && selectedIds.has(a.id))
      .sort((a,b) => a.createdAt - b.createdAt);
    
    try {
      const mergedBase64 = await mergeBase64Audios(itemsToMerge.map(i => i.audioData));
      
      const newItem: AudioItem = {
        title: `Merged Sequence - ${itemsToMerge.length} files`,
        type: 'merged',
        createdAt: Date.now(),
        audioData: mergedBase64
      };
      await db.audios.add(newItem);
      await loadAudios();
      
      setSelectionMode(false);
      setSelectedIds(new Set());
      setActiveFolder('merged');
    } catch (err: any) {
      setErrorMsg('Failed to merge audios.');
    }
  };

  const handleDelete = async (id: number) => {
    await db.audios.delete(id);
    if (lastGeneratedId === id) setLastGeneratedId(null);
    await loadAudios();
    setOpenDropdownId(null);
  };

    const handleDownload = (item: AudioItem) => {
    try {
      const pcm = base64ToInt16Array(item.audioData);
      const blob = pcmToMp3Blob(pcm, 24000);
      downloadBlob(blob, `${item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp3`);
      setOpenDropdownId(null);
    } catch (e) {
      setErrorMsg("Failed to download mp3");
    }
  };
  
  const handleDownloadLatest = () => {
    if (!lastGeneratedId) return;
    const item = audios.find(a => a.id === lastGeneratedId);
    if (item) handleDownload(item);
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudioItem = async (item: AudioItem) => {
    if (playingItem?.id === item.id) {
        setPlayingItem(null);
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
        return;
    }
    
    if (audioRef.current) {
        audioRef.current.pause();
    }
    if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
    }

    const pcm = base64ToInt16Array(item.audioData);
    const blob = pcmToMp3Blob(pcm, 24000);
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);
    setPlayingItem(item);

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
        setPlayingItem(null);
        setAudioUrl(null);
        URL.revokeObjectURL(url);
    };
    audio.play().catch(() => {});
  };

  const installPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  const closeIntro = () => {
    localStorage.setItem('INTRO_SEEN', 'true');
    setShowIntro(false);
  };

  return (
    <div className="flex h-[100dvh] w-full bg-[#0a0a0c] text-white font-sans overflow-hidden" onClick={() => setOpenDropdownId(null)}>
      
      {/* Intro Modal */}
      <AnimatePresence>
        {showIntro && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: -20 }}
              transition={{ type: "spring", damping: 20 }}
              className="bg-[#161618] border border-[#00f3ff]/20 rounded-3xl p-8 w-full max-w-lg shadow-[0_0_50px_rgba(0,243,255,0.1)] relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00f3ff] to-transparent opacity-50"></div>
              
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="w-16 h-16 bg-[#00f3ff]/10 rounded-2xl border border-[#00f3ff]/30 shadow-[0_0_30px_rgba(0,243,255,0.2)] flex items-center justify-center">
                  <RadioReceiver size={32} className="text-[#00f3ff]" />
                </div>
                
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold tracking-tight">Mutu <span className="text-[#00f3ff]">Audio</span></h1>
                  <p className="text-gray-400 text-sm max-w-[280px] mx-auto">
                    Premium vocal synthesis platform powered by cutting-edge AI.
                  </p>
                </div>

                <div className="w-full flex-1 flex flex-col gap-3 mt-4">
                  <button 
                    onClick={closeIntro}
                    className="w-full py-4 rounded-xl bg-[#00f3ff] text-black font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(0,243,255,0.3)] hover:shadow-[0_0_30px_rgba(0,243,255,0.5)] transition-all hover:bg-cyan-300"
                  >
                    ENTER STUDIO
                  </button>
                  {deferredPrompt && (
                    <button 
                      onClick={installPWA}
                      className="w-full py-4 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-sm tracking-wide hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                    >
                      <DownloadCloud size={18} className="text-[#00f3ff]"/> INSTALL APP
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }}
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`absolute md:relative flex-shrink-0 w-64 h-full bg-[#161618] border-r border-[#00f3ff]/10 flex flex-col z-40 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-[#00f3ff] rounded-lg shadow-[0_0_15px_rgba(0,243,255,0.4)] flex items-center justify-center">
               <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>
             </div>
             <span className="text-xl font-bold tracking-tight">Mutu <span className="text-[#00f3ff]">Audio</span></span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-gray-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-6 overflow-hidden flex flex-col">
          <div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3 px-2">
              <span>Library</span>
              <button 
                onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
                className={`hover:text-[#00f3ff] transition-colors ${selectionMode ? 'text-[#00f3ff]' : ''}`}
              >
                {selectionMode ? 'Cancel' : 'Selection Mode'}
              </button>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => setActiveFolder('recent')}
                className={`w-full flex items-center gap-3 p-3 rounded-sm transition-colors cursor-pointer ${activeFolder === 'recent' ? 'bg-[#00f3ff]/5 text-[#00f3ff] border-r-2 border-[#00f3ff]' : 'text-gray-400 hover:bg-white/5'}`}
              >
                <Folder size={16} />
                <span className="text-sm font-medium">Recent Audio</span>
              </button>
              <button
                onClick={() => setActiveFolder('merged')}
                className={`w-full flex items-center gap-3 p-3 rounded-sm transition-colors cursor-pointer ${activeFolder === 'merged' ? 'bg-[#00f3ff]/5 text-[#00f3ff] border-r-2 border-[#00f3ff]' : 'text-gray-400 hover:bg-white/5'}`}
              >
                <Folder size={16} />
                <span className="text-sm font-medium">Merged Audio</span>
              </button>
            </div>
          </div>

                {/* Sub-list inside Sidebar for Active Folder items */}
                <div className="flex-1 overflow-y-auto border-t border-white/5 p-3">
                  <div className="flex justify-between items-center mb-3 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                    <span>{activeFolder === 'recent' ? 'Current Files' : 'Sequences'}</span>
                    {activeFolder === 'recent' && (
                      <button 
                        onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
                        className={`hover:text-[#00f3ff] transition-colors ${selectionMode ? 'text-[#00f3ff]' : ''}`}
                      >
                        {selectionMode ? 'Cancel' : 'Select'}
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    {audios.filter(a => a.type === activeFolder).length === 0 && (
                      <div className="text-xs text-gray-500 italic text-center p-4">Empty folder</div>
                    )}
                    {audios.filter(a => a.type === activeFolder).map(item => (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={item.id} 
                        className={`group p-3 bg-[#1c1c1f] rounded-lg border hover:border-[#00f3ff]/30 transition-all flex flex-col gap-2 ${selectionMode && selectedIds.has(item.id!) ? 'border-[#00f3ff]/50 bg-[#00f3ff]/5' : 'border-white/5'}`}
                      >
                        <div className="flex items-start gap-2">
                          {selectionMode && activeFolder === 'recent' && (
                            <button onClick={() => toggleSelection(item.id!)} className="mt-1 text-gray-500 hover:text-[#00f3ff]">
                              {selectedIds.has(item.id!) ? <CheckSquare size={16} className="text-[#00f3ff] drop-shadow-[0_0_5px_rgba(0,243,255,0.8)]" /> : <Square size={16} />}
                            </button>
                          )}
                          <div className="flex-1 min-w-0 pr-2">
                            <p className="text-xs font-semibold truncate" title={item.title}>{item.title}</p>
                            <p className="text-[10px] text-gray-500">{new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</p>
                          </div>
                          
                          <div className="flex items-center gap-1 relative">
                            <button onClick={() => playAudioItem(item)} className="p-1 hover:bg-white/5 rounded text-gray-400 hover:text-[#00f3ff] transition-colors" title={playingItem?.id === item.id ? "Stop" : "Play"}>
                              {playingItem?.id === item.id ? <Square size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
                            </button>
                            
                            {!selectionMode && (
                              <div className="relative">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setOpenDropdownId(openDropdownId === item.id ? null : item.id!); }}
                                  className="p-1 hover:bg-white/5 rounded text-gray-500 transition-colors opacity-50 group-hover:opacity-100"
                                >
                                  <MoreVertical size={14} />
                                </button>
                                
                                {openDropdownId === item.id && (
                                  <div className="absolute right-0 top-full mt-1 w-36 bg-[#161618] border border-[#00f3ff]/20 rounded-lg shadow-xl py-1 z-50">
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); setEditItem(item); setEditTitle(item.title); setOpenDropdownId(null); }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#00f3ff]/10 hover:text-[#00f3ff] flex items-center gap-2"
                                    >
                                      <Edit2 size={14} /> Rename
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleDownload(item); }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#00f3ff]/10 hover:text-[#00f3ff] flex items-center gap-2"
                                    >
                                      <Download size={14} /> Download
                                    </button>
                                    <div className="h-px bg-white/5 w-full my-1"></div>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleDelete(item.id!); }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-red-500/10 text-red-400 flex items-center gap-2"
                                    >
                                      <Trash2 size={14} /> Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {selectionMode && activeFolder === 'recent' && (
                    <div className="mt-4 pt-2 border-t border-white/5">
                       <button
                         onClick={handleMerge}
                         disabled={selectedIds.size < 2 || selectedIds.size > 5}
                         className="w-full py-2 bg-[#00f3ff] text-black hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold flex justify-center items-center gap-2 transition-colors shadow-[0_0_15px_rgba(0,243,255,0.4)]"
                       >
                         <Merge size={16} /> Merge ({selectedIds.size})
                       </button>
                    </div>
                  )}
                </div>
        </nav>

        <div className="p-4 border-t border-white/5 bg-[#0a0a0c]/50">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={(e) => { e.stopPropagation(); setSettingsOpen(true); }}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#00f3ff] to-cyan-800 p-[1px]">
              <div className="w-full h-full rounded-full bg-[#161618] flex items-center justify-center text-[10px]">API</div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium group-hover:text-[#00f3ff] transition-colors">Gemini v2.5</p>
              <p className="text-[10px] text-[#00f3ff] opacity-70 flex items-center gap-1">
                 <span className={`w-1.5 h-1.5 rounded-full ${apiKey ? 'bg-[#00f3ff]' : 'bg-red-500'}`}></span>
                 {apiKey ? 'API Configured' : 'Missing Key'}
              </p>
            </div>
            <Settings size={16} className="text-gray-500 group-hover:text-white transition-colors" />
          </div>
        </div>
      </aside>

        {/* Main Content Pane */}
        <main className="flex-1 flex flex-col relative h-full min-w-0">
          
          {/* Top Action Bar */}
          <header className="h-16 shrink-0 border-b border-white/5 flex items-center justify-between px-4 md:px-8 bg-[#0a0a0c] z-10 relative">
            <div className="flex items-center gap-4">
              <button className="md:hidden text-gray-400 hover:text-white" onClick={(e) => { e.stopPropagation(); setSidebarOpen(true); }}>
                <MoreVertical size={20} />
              </button>
              <h2 className="text-lg font-medium hidden sm:block">New Audio Generation</h2>
              <div className="px-2 py-1 bg-[#00f3ff]/10 border border-[#00f3ff]/30 rounded text-[10px] text-[#00f3ff] font-bold">PRO PLAN</div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-gray-500 uppercase tracking-tighter">Processing Status</span>
                <span className={`text-xs font-mono tracking-wide ${isGenerating ? 'text-[#00f3ff] animate-pulse' : 'text-gray-500'}`}>
                  {isGenerating ? 'SYNTHESIZING' : 'SYSTEM.IDLE'}
                </span>
              </div>
            </div>
          </header>

          {/* Progress Bar (Sticky under header) */}
          <div className="w-full h-[2px] bg-white/5 overflow-hidden shrink-0 z-10 relative">
            {progress > 0 && progress < 100 && (
               <div className="h-full bg-[#00f3ff] shadow-[0_0_10px_#00f3ff]" style={{ width: `${progress}%`, transition: 'width 0.2s linear' }}></div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-4 md:gap-6 relative z-0">
            {errorMsg && (
               <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-[#1c1c1f] border border-red-500/30 text-red-500 rounded-xl text-sm font-medium shrink-0">
                 {errorMsg}
               </motion.div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 shrink-0">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Scene Description</label>
                <textarea 
                  value={scene}
                  onChange={e => setScene(e.target.value)}
                  placeholder="e.g. A rainy futuristic alleyway at night..." 
                  className="w-full h-24 bg-[#161618] border border-white/10 rounded-xl p-4 text-sm focus:border-[#00f3ff] focus:ring-1 focus:ring-[#00f3ff] outline-none transition-all resize-none placeholder:text-gray-700 text-white" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Acoustic Context</label>
                <textarea 
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder="e.g. Muffled voices, high reverb, synth hum..." 
                  className="w-full h-24 bg-[#161618] border border-white/10 rounded-xl p-4 text-sm focus:border-[#00f3ff] focus:ring-1 focus:ring-[#00f3ff] outline-none transition-all resize-none placeholder:text-gray-700 text-white" />
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-2 min-h-[250px]">
               <label className="text-[10px] uppercase font-bold text-gray-500 px-1">Voice Script</label>
               <textarea 
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Enter the text for AI synthesis here..." 
                  className="flex-1 w-full bg-[#161618] border border-white/10 rounded-xl p-4 md:p-6 text-base leading-relaxed focus:border-[#00f3ff] focus:ring-1 focus:ring-[#00f3ff] outline-none transition-all resize-none placeholder:text-gray-700 font-serif text-white flex-1"></textarea>
            </div>
          </div>

           <div className="bg-[#161618] border-t border-b border-white/10 p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
               <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto items-stretch md:items-center">
                  <div className="w-full md:w-64 shrink-0">
                     <label className="text-[9px] uppercase font-bold text-gray-500 px-1 mb-1 block">Select Narrator</label>
                     <div className="relative">
                        <select 
                          value={voice}
                          onChange={e => setVoice(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-white/10 rounded-lg py-3 md:py-2.5 px-4 text-sm appearance-none cursor-pointer focus:border-[#00f3ff] outline-none text-white">
                           <option value="Puck">Puck (Playful / Sharp)</option>
                           <option value="Charon">Charon (Grave / Resonant)</option>
                           <option value="Aoede">Aoede (Ethereal / Fluid)</option>
                           <option value="Kore">Kore (Calm / Level)</option>
                           <option value="Fenrir">Fenrir (Intense / Deep)</option>
                           <option value="Zephyr">Zephyr (Breezy / Light)</option>
                        </select>
                        <div className="absolute right-3 top-3.5 md:top-3 pointer-events-none text-gray-500">
                           <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                        </div>
                     </div>
                  </div>
                  <div className="w-full md:w-48 shrink-0">
                     <label className="text-[9px] uppercase font-bold text-gray-500 px-1 mb-1 block">Model</label>
                     <div className="relative">
                        <select 
                          value={model}
                          onChange={e => setModel(e.target.value)}
                          className="w-full bg-[#0a0a0c] border border-white/10 rounded-lg py-3 md:py-2.5 px-4 text-sm appearance-none cursor-pointer focus:border-[#00f3ff] outline-none text-white">
                           <option value="gemini-3.1-flash-tts-preview">3.1 Flash</option>
                           <option value="gemini-2.5-pro-preview-tts">2.5 Pro Preview</option>
                           <option value="gemini-2.5-flash">2.5 Flash</option>
                        </select>
                        <div className="absolute right-3 top-3.5 md:top-3 pointer-events-none text-gray-500">
                           <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="flex flex-row items-center justify-end gap-2 sm:gap-3 w-full md:w-auto shrink-0">
                  {lastGeneratedId && (
                    <button onClick={handleDownloadLatest} className="flex-1 md:flex-none px-4 py-3.5 md:py-3 border border-white/10 rounded-xl text-sm font-semibold hover:bg-white/5 flex justify-center items-center gap-2 transition-colors text-white">
                       <Download size={16} /> <span className="hidden sm:inline">Download</span>
                    </button>
                  )}
                  
                  <button 
                    onClick={handleRun}
                    disabled={isGenerating}
                    className="flex-[2] md:flex-none px-4 sm:px-8 py-3.5 md:py-3 bg-[#00f3ff] text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 hover:bg-cyan-300 transition-all shadow-[0_0_25px_rgba(0,243,255,0.2)] hover:shadow-[0_0_35px_rgba(0,243,255,0.4)] disabled:opacity-70 disabled:cursor-not-allowed">
                     {isGenerating ? <Loader2 size={16} className="animate-spin shrink-0" /> : <Play size={16} className="fill-current shrink-0" />}
                     <span className="truncate">{isGenerating ? 'RUNNING...' : 'GENERATE AUDIO'}</span>
                  </button>
               </div>
            </div>

          {/* Simple Floating Player */}
          {playingItem && (
             <div className="absolute bottom-24 right-4 md:right-8 bg-[#0a0a0c] border border-[#00f3ff]/40 shadow-[0_10px_30px_rgba(0,243,255,0.15)] rounded-2xl p-4 flex items-center justify-between gap-4 z-50 w-[calc(100%-2rem)] md:w-72">
                <div className="flex flex-col min-w-0">
                   <div className="flex items-center gap-2 mb-1">
                      <div className="flex gap-[2px] items-end h-3">
                         <motion.div animate={{ height: ["40%", "100%", "40%"] }} transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }} className="w-1 bg-[#00f3ff] rounded-full"></motion.div>
                         <motion.div animate={{ height: ["80%", "30%", "80%"] }} transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} className="w-1 bg-[#00f3ff] rounded-full"></motion.div>
                         <motion.div animate={{ height: ["50%", "90%", "50%"] }} transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }} className="w-1 bg-[#00f3ff] rounded-full"></motion.div>
                      </div>
                      <span className="text-[10px] text-[#00f3ff] uppercase font-bold tracking-widest">Playing</span>
                   </div>
                   <span className="text-sm font-medium text-white truncate">{playingItem.title}</span>
                </div>
                <button onClick={() => playAudioItem(playingItem)} className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-colors">
                   <Square size={16} className="fill-current" />
                </button>
             </div>
          )}

          {/* Bottom Status Bar */}
          <footer className="h-8 shrink-0 bg-[#161618] border-t border-white/5 px-4 md:px-8 flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-widest font-medium z-10 relative">
             <div className="flex gap-4 md:gap-6">
                <span className="flex items-center gap-1.5">
                   <span className="w-1 h-1 rounded-full bg-[#00f3ff]"></span>
                   Connection: Secure
                </span>
                <span className="hidden sm:inline">Server: gemini.ai</span>
             </div>
             <div className="flex gap-4">
                <span>v.1.2.0-beta</span>
                <span className="hidden md:inline">© {new Date().getFullYear()} MUTU LABS</span>
             </div>
          </footer>
        </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#161618] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <button onClick={() => setSettingsOpen(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white">
                <X size={20} />
              </button>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-white">
                <Settings size={20} className="text-[#00f3ff]" /> API Configuration
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 px-1 mb-1">Gemini API Key</label>
                  <input 
                    type="password" 
                    value={apiKey} 
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIza..."
                    className="w-full bg-[#0a0a0c] border border-white/10 rounded-lg p-3 text-sm focus:border-[#00f3ff] focus:ring-1 focus:ring-[#00f3ff] outline-none text-white font-mono"
                  />
                  <p className="text-[10px] text-gray-500 mt-2 px-1">
                    Required for access to gemini-2.5-pro-preview-tts. Stored locally.
                  </p>
                </div>
                <button 
                  onClick={handleSaveApiKey}
                  className="w-full bg-[#00f3ff]/10 hover:bg-[#00f3ff]/20 border border-[#00f3ff]/30 text-[#00f3ff] py-3 rounded-lg text-sm font-bold transition-colors shadow-[0_0_15px_rgba(0,243,255,0.1)] flex items-center justify-center gap-2"
                >
                  <Save size={16} /> Save Configuration
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editItem && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: -10 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#161618] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <button onClick={() => setEditItem(null)} className="absolute top-4 right-4 text-gray-500 hover:text-white">
                <X size={20} />
              </button>
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-white">
                <Edit2 size={18} className="text-[#00f3ff]" /> Rename File
              </h2>
              <div className="space-y-4">
                <input 
                  type="text" 
                  value={editTitle} 
                  autoFocus
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-[#0a0a0c] border border-white/10 rounded-lg p-3 text-base focus:border-[#00f3ff] focus:ring-1 focus:ring-[#00f3ff] outline-none text-white"
                  onKeyDown={async (e) => {
                    if(e.key === 'Enter') {
                        if (editItem.id && editTitle.trim()) {
                            await db.audios.update(editItem.id, { title: editTitle.trim() });
                            await loadAudios();
                            setEditItem(null);
                        }
                    }
                  }}
                />
                <button 
                  onClick={async () => {
                      if (editItem.id && editTitle.trim()) {
                          await db.audios.update(editItem.id, { title: editTitle.trim() });
                          await loadAudios();
                          setEditItem(null);
                      }
                  }}
                  className="w-full bg-[#00f3ff]/10 hover:bg-[#00f3ff]/20 border border-[#00f3ff]/30 text-[#00f3ff] py-3 rounded-lg font-bold transition-colors"
                >
                  Confirm Rename
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
