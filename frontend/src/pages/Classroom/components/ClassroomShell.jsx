import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    PiGearFill,
    PiXFill,
    PiClockFill,
    PiTrayFill,
    PiPaperclipFill,
    PiMicrophoneFill,
    PiPaperPlaneTiltFill,
    PiRobotFill,
    PiUserCircleFill,
    PiWifiSlashFill,
    PiWarningCircleFill,
    PiChatTeardropTextFill,
    PiSlidersHorizontalFill,
    PiChatCircleTextFill,
    PiArrowRightFill,
    PiSignOutFill,
} from "react-icons/pi";
import { getAvatarById } from "../../../data/avatars";


const AvatarScene = lazy(() => import("./AvatarScene.jsx"));

const HEALTH_URL      = "/api/health";
const HEALTH_INTERVAL = 15_000;

// ── Avatar loading progress bar ─────────────────────
function AvatarProgressBar({ done, onBarGone }) {
    const [progress, setProgress] = useState(0);
    const [hidden,   setHidden]   = useState(false);
    const tickRef  = useRef(null);

    // Ramp quickly to ~88%, then decelerate (eased approach)
    useEffect(() => {
        tickRef.current = setInterval(() => {
            setProgress((p) => {
                if (p >= 88) return p;
                return p + (88 - p) * 0.072;
            });
        }, 70);
        return () => clearInterval(tickRef.current);
    }, []);

    // When the 3D scene signals ready → fill to 100%, fade out, THEN reveal avatar
    useEffect(() => {
        if (!done) return;
        clearInterval(tickRef.current);
        setProgress(100);
        const t = setTimeout(() => {
            onBarGone?.();   // ← avatar becomes visible only now
            setHidden(true);
        }, 600);             // matches CSS opacity transition
        return () => clearTimeout(t);
    }, [done, onBarGone]);

    if (hidden) return null;

    return (
        <div className={`avatar-progress-bar${done ? " done" : ""}`}>
            <div className="avatar-progress-bar__track">
                <div
                    className="avatar-progress-bar__fill"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
}

export default function ClassroomShell() {
    const navigate = useNavigate();

    // ── Core state ─────────────────────────────────────
    const [messages,       setMessages]       = useState([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [inputValue,     setInputValue]     = useState("");
    const [avatarData,     setAvatarData]     = useState(null);

    // ── Avatar loading ───────────────────────────────────
    const [avatarLoaded,  setAvatarLoaded]  = useState(false);
    const [avatarVisible, setAvatarVisible] = useState(false);

    // ── Backend status ──────────────────────────────────
    const [backendStatus,  setBackendStatus]  = useState("checking");
    const [offlineWarning, setOfflineWarning] = useState(false);

    // ── Refs ────────────────────────────────────────────
    const messagesEndRef      = useRef(null);
    const chatScrollRef       = useRef(null);
    const shouldStickToBottom = useRef(true);
    const offlineTimerRef     = useRef(null);

    // ── Load avatar from settings ───────────────────────
    useEffect(() => {
        try {
            const saved = localStorage.getItem("virtai-settings");
            if (!saved) return;
            const settings = JSON.parse(saved);
            if (settings?.character) setAvatarData(getAvatarById(settings.character) || null);
        } catch { /* ignore parse errors */ }
    }, []);

    // ── Backend health check (ping every 15 s) ──────────
    useEffect(() => {
        const check = async () => {
            try {
                const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
                setBackendStatus(res.ok ? "online" : "offline");
            } catch {
                setBackendStatus("offline");
            }
        };
        check();
        const id = setInterval(check, HEALTH_INTERVAL);
        return () => clearInterval(id);
    }, []);

    // ── Auto-scroll ─────────────────────────────────────
    const handleChatScroll = () => {
        const el = chatScrollRef.current;
        if (!el) return;
        shouldStickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
    };

    useEffect(() => {
        if (!shouldStickToBottom.current) return;
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, [messages]);

    // ── Offline toast ───────────────────────────────────
    const showOfflineWarning = useCallback(() => {
        setOfflineWarning(true);
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = setTimeout(() => setOfflineWarning(false), 4000);
    }, []);

    // ── Send message ────────────────────────────────────
    const canSend = inputValue.trim().length > 0;

    const handleSendMessage = () => {
        const text = inputValue.trim();
        if (!text) return;

        if (backendStatus === "offline") {
            showOfflineWarning();
            return;
        }

        setMessages((prev) => [
            ...prev,
            {
                id: Date.now(),
                role: "user",
                content: text,
                timestamp: new Date().toISOString(),
            },
        ]);
        setInputValue("");
    };

    const onKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // ── Derived UI ──────────────────────────────────────
    const avatarName = avatarData?.name || "AI Tutor";

    const statusBadgeClass =
        backendStatus === "offline"   ? "offline"
        : backendStatus === "checking" ? "connecting"
        : "online";

    const statusLabel =
        backendStatus === "offline"   ? `${avatarName} — Offline`
        : backendStatus === "checking" ? "Connecting…"
        : `${avatarName} Online`;

    // ── Render ──────────────────────────────────────────
    return (
        <div className="classroom-shell">

            {/* Settings Drawer */}
            {isSettingsOpen && (
                <div className="settings-drawer open">
                    <div className="drawer-overlay" onClick={() => setIsSettingsOpen(false)} />
                    <div className="drawer-content">

                        {/* Header */}
                        <div className="drawer-header">
                            <div className="drawer-title-group">
                                <PiSlidersHorizontalFill className="drawer-title-icon" />
                                <h2 className="drawer-title">Settings</h2>
                            </div>
                            <button
                                className="drawer-close"
                                onClick={() => setIsSettingsOpen(false)}
                                aria-label="Close settings"
                            >
                                <PiXFill />
                            </button>
                        </div>

                        {/* ── Scrollable body: conversations ── */}
                        <div className="drawer-body">

                            {/* Session — Chat History */}
                            <div className="drawer-section">
                                <h3 className="drawer-section-title">
                                    <PiClockFill /> Session
                                </h3>

                                {messages.filter((m) => m.role === "user").length > 0 ? (
                                    <div className="drawer-info-row">
                                        <PiChatCircleTextFill className="drawer-info-icon" />
                                        <span className="drawer-info-label">Messages</span>
                                        <span className="drawer-info-value">
                                            {messages.filter((m) => m.role === "user").length}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="empty-state">
                                        <PiTrayFill />
                                        <p>No messages yet</p>
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* ── Pinned footer: Tutor + Navigation ── */}
                        <div className="drawer-footer">

                            {/* Avatar info */}
                            <div className="drawer-section">
                                <h3 className="drawer-section-title">
                                    <PiRobotFill /> Tutor
                                </h3>
                                <div className="drawer-info-row">
                                    <PiUserCircleFill className="drawer-info-icon" />
                                    <span className="drawer-info-label">Active tutor</span>
                                    <span className="drawer-info-value">{avatarName}</span>
                                </div>
                                <div className="drawer-info-row">
                                    <PiWifiSlashFill
                                        className="drawer-info-icon"
                                        style={{ color: backendStatus === "offline" ? "#ef4444" : "var(--success)" }}
                                    />
                                    <span className="drawer-info-label">Server</span>
                                    <span
                                        className="drawer-info-value"
                                        style={{ color: backendStatus === "offline" ? "#ef4444" : backendStatus === "checking" ? "var(--warning)" : "var(--success)" }}
                                    >
                                        {backendStatus === "offline" ? "Offline" : backendStatus === "checking" ? "Checking…" : "Online"}
                                    </span>
                                </div>
                            </div>

                            {/* Navigation */}
                            <div className="drawer-section">
                                <h3 className="drawer-section-title">
                                    <PiArrowRightFill /> Navigation
                                </h3>
                                <button className="back-to-overview-btn" onClick={() => navigate("/")}>
                                    <PiSignOutFill />
                                    <span>Exit to Overview</span>
                                </button>
                            </div>

                        </div>

                    </div>
                </div>
            )}

            {/* Settings button */}
            <button
                className="avatar-settings-btn"
                onClick={() => setIsSettingsOpen(true)}
                title="Settings"
            >
                <PiGearFill />
            </button>

            {/* Status badge */}
            <div className={`avatar-status-badge ${statusBadgeClass}`}>
                {backendStatus === "offline"
                    ? <PiWifiSlashFill className="status-icon-offline" />
                    : <span className={`status-dot${backendStatus === "checking" ? " status-dot-connecting" : ""}`} />
                }
                <span className="status-text">{statusLabel}</span>
            </div>

            {/* Offline warning toast */}
            {offlineWarning && (
                <div className="offline-toast" role="alert">
                    <PiWarningCircleFill className="toast-icon" />
                    <span>Server is offline — your message could not be sent.</span>
                </div>
            )}

            {/* Split Screen */}
            <div className="split-container">

                {/* Left: Avatar 3D */}
                <div className="avatar-panel">

                    {/* Canvas renders silently behind the bar; revealed only after bar is gone */}
                    <div className={`avatar-canvas-wrapper${avatarVisible ? " visible" : ""}`}>
                        <Suspense fallback={null}>
                            <AvatarScene
                                avatarData={avatarData}
                                onAvatarLoaded={() => setAvatarLoaded(true)}
                            />
                        </Suspense>
                    </div>

                    {/* Full-panel dark overlay + centered progress bar */}
                    <AvatarProgressBar
                        done={avatarLoaded}
                        onBarGone={() => setAvatarVisible(true)}
                    />
                </div>

                {/* Right: Chat */}
                <div className="chat-panel">
                    <div
                        className="chat-messages"
                        ref={chatScrollRef}
                        onScroll={handleChatScroll}
                    >
                        {messages.length === 0 ? (
                            <div className="welcome-state">
                                <PiChatTeardropTextFill className="welcome-icon" />
                                <h2 className="welcome-title">Start a conversation</h2>
                                <p className="welcome-subtitle">
                                    Ask {avatarName} anything to begin your lesson.
                                </p>
                            </div>
                        ) : (
                            <div className="chat-stream">
                                {messages.map((msg) => {
                                    const isUser = msg.role === "user";
                                    return (
                                        <div
                                            key={msg.id}
                                            className={`chat-message-wrapper ${
                                                isUser ? "user-message-wrapper" : "ai-message-wrapper"
                                            }`}
                                        >
                                            <div className={`chat-message ${
                                                isUser ? "user-message" : "ai-message"
                                            }`}>
                                                {!isUser && (
                                                    <div className="message-avatar">
                                                        <PiRobotFill />
                                                    </div>
                                                )}
                                                <div className="message-bubble">{msg.content}</div>
                                                {isUser && (
                                                    <div className="message-avatar">
                                                        <PiUserCircleFill />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>
                        )}
                    </div>

                    {/* Input bar */}
                    <div className="chat-input-bar">
                        <button className="input-icon-btn" title="Attach file" type="button" disabled>
                            <PiPaperclipFill />
                        </button>
                        <button className="input-icon-btn" title="Voice input" type="button" disabled>
                            <PiMicrophoneFill />
                        </button>

                        <input
                            type="text"
                            className="chat-input"
                            placeholder={
                                backendStatus === "offline"
                                    ? "Server offline — cannot send messages"
                                    : "Type a message…"
                            }
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={onKeyDown}
                        />

                        <button
                            className="send-btn"
                            onClick={handleSendMessage}
                            title="Send message"
                            type="button"
                            disabled={!canSend}
                            style={{ opacity: canSend ? 1 : 0.5 }}
                        >
                            <PiPaperPlaneTiltFill />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

