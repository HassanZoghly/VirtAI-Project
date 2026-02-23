import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PiUserFill, PiFileArrowUpFill, PiCheckCircleFill, PiX } from "react-icons/pi";
import { avatarImages } from "../../data/avatars";
import { LiquidButton } from "../../components/buttons/liquid";
import "./Setup.css";

// ===== CONSTANTS =====
const VOICES = [
    { value: "aria", label: "Aria", description: "Female, Friendly", gender: "female" },
    { value: "ada", label: "Ada", description: "Female, Friendly", gender: "female" },
    { value: "nova", label: "Nova", description: "Female, Professional", gender: "female" },
    { value: "alloy", label: "Alloy", description: "Male, Neutral", gender: "male" },
    { value: "echo", label: "Echo", description: "Male, Friendly", gender: "male" },
    { value: "fable", label: "Fable", description: "Male, British", gender: "male" },
    { value: "onyx", label: "Onyx", description: "Male, Deep", gender: "male" },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "text/plain": "txt"
};
const ALLOWED_EXTENSIONS = [".pdf", ".txt"];

const STORAGE_KEY = "virtai-settings";

// ===== UTILITIES =====
const formatFileSize = (bytes) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    const value = Math.round((bytes / Math.pow(k, i)) * 100) / 100;
    return `${value} ${sizes[i]}`;
};

const getFileIcon = (fileName) => {
    return fileName.toLowerCase().endsWith(".pdf") ? "📄" : "📝";
};

// ===== MAIN COMPONENT =====
const Setup = () => {
    const navigate = useNavigate();

    // State
    const [currentStep, setCurrentStep] = useState(1);
    const [selectedCharacter, setSelectedCharacter] = useState("mariam");
    const [voice, setVoice] = useState("aria");
    const [username, setUsername] = useState("");
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);

    // Memoized values
    const selectedAvatar = useMemo(() => avatarImages[selectedCharacter], [selectedCharacter]);
    
    const filteredVoices = useMemo(() => {
        const gender = selectedAvatar?.gender;
        if (!gender) return VOICES;
        return VOICES.filter((v) => v.gender === gender);
    }, [selectedAvatar?.gender]);

    const selectedVoice = useMemo(
        () => VOICES.find((v) => v.value === voice) || VOICES[0],
        [voice]
    );

    const canProceed = useMemo(() => {
        switch (currentStep) {
            case 1: return true; // Always can proceed from step 1
            case 2: return true; // Files are optional
            case 3: return true; // Always can proceed from step 3
            default: return false;
        }
    }, [currentStep]);

    // Load saved settings
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return;
            
            const settings = JSON.parse(saved);
            if (settings?.character && avatarImages[settings.character]) {
                setSelectedCharacter(settings.character);
            }
            if (settings?.voice) setVoice(settings.voice);
            if (typeof settings?.username === "string") setUsername(settings.username);
        } catch {
            // Silently fail - use defaults
        }
    }, []);

    // Sync voice with avatar gender
    useEffect(() => {
        const currentVoice = VOICES.find((v) => v.value === voice);
        if (!selectedAvatar?.gender || !currentVoice) return;

        if (currentVoice.gender !== selectedAvatar.gender) {
            const matching = VOICES.find((v) => v.gender === selectedAvatar.gender);
            if (matching) setVoice(matching.value);
        }
    }, [selectedAvatar?.gender, voice]);

    // Handlers
    const handleNext = useCallback(() => {
        if (currentStep < 3) {
            setCurrentStep((s) => s + 1);
            return;
        }

        // Save settings
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                character: selectedCharacter,
                voice,
                username,
                filesCount: uploadedFiles.length,
                timestamp: Date.now(),
            }));
        } catch {
            // Ignore storage errors
        }

        navigate("/classroom");
    }, [currentStep, selectedCharacter, voice, username, uploadedFiles.length, navigate]);

    const handleBack = useCallback(() => {
        if (currentStep > 1) {
            setCurrentStep((s) => s - 1);
        } else {
            navigate("/");
        }
    }, [currentStep, navigate]);

    const handleFileUpload = useCallback((files) => {
        if (!files?.length) return;

        const valid = Array.from(files).filter((f) => {
            const isValidType = ALLOWED_TYPES[f.type] || 
                ALLOWED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext));
            const isValidSize = f.size <= MAX_FILE_SIZE;
            return isValidType && isValidSize;
        });

        if (valid.length) {
            setUploadedFiles((prev) => [...prev, ...valid]);
        }
    }, []);

    const handleFileInput = useCallback((e) => {
        handleFileUpload(e.target.files);
        e.target.value = ""; // Allow selecting same file again
    }, [handleFileUpload]);

    const removeFile = useCallback((index) => {
        setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileUpload(e.dataTransfer.files);
    }, [handleFileUpload]);

    return (
        <section className="setup">
            <div className="setup__container">
                {/* Header */}
                <header className="setup__header">
                    <h1 className="setup__title">Session Setup</h1>
                    <div className="setup__progress" role="progressbar" aria-valuenow={currentStep} aria-valuemin={1} aria-valuemax={3}>
                        {[1, 2, 3].map((step) => (
                            <div
                                key={step}
                                className={`setup__progress-step ${currentStep >= step ? "active" : ""}`}
                                aria-hidden="true"
                            />
                        ))}
                    </div>
                </header>

                {/* Tabs */}
                <nav className="setup__tabs" aria-label="Setup steps">
                    {[
                        { step: 1, icon: PiUserFill, label: "Avatar & Voice" },
                        { step: 2, icon: PiFileArrowUpFill, label: "Upload Docs" },
                        { step: 3, icon: PiCheckCircleFill, label: "All Set" },
                    ].map(({ step, icon: Icon, label }) => (
                        <button
                            key={step}
                            className={`setup__tab ${currentStep === step ? "active" : ""}`}
                            onClick={() => setCurrentStep(step)}
                            aria-current={currentStep === step ? "step" : undefined}
                        >
                            <Icon className="setup__tab-icon" aria-hidden="true" />
                            <span className="setup__tab-label">{label}</span>
                        </button>
                    ))}
                </nav>

                {/* Content */}
                <div className="setup__content">
                    {/* Step 1: Avatar & Voice */}
                    {currentStep === 1 && (
                        <div className="setup__step active">
                            <h2 className="setup__step-title">Choose Your Character</h2>
                            
                            <div className="character-grid" role="radiogroup" aria-label="Character selection">
                                {Object.values(avatarImages).map((char) => (
                                    <div
                                        key={char.id}
                                        className={`character-card ${selectedCharacter === char.id ? "selected" : ""}`}
                                        onClick={() => setSelectedCharacter(char.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                setSelectedCharacter(char.id);
                                            }
                                        }}
                                        role="radio"
                                        aria-checked={selectedCharacter === char.id}
                                        tabIndex={0}
                                    >
                                        <div className="character-card__avatar">
                                            <img src={char.image} alt={char.name} loading="lazy" />
                                        </div>
                                        <h3 className="character-card__name">{char.name}</h3>
                                        <p className="character-card__description">{char.description}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="setup__field">
                                <label htmlFor="voice-select" className="setup__label">
                                    Assistant Voice
                                </label>
                                <select
                                    id="voice-select"
                                    className="setup__select"
                                    value={voice}
                                    onChange={(e) => setVoice(e.target.value)}
                                    aria-describedby="voice-description"
                                >
                                    {filteredVoices.map((v) => (
                                        <option key={v.value} value={v.value}>
                                            {v.label} — {v.description}
                                        </option>
                                    ))}
                                </select>
                                <p id="voice-description" className="setup__field-hint">
                                    Choose the voice that matches your character's personality
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Upload Documents */}
                    {currentStep === 2 && (
                        <div className="setup__step active">
                            <h2 className="setup__step-title">Upload Learning Materials</h2>
                            
                            <div className="upload-section">
                                <div
                                    className={`upload-area ${isDragging ? "dragging" : ""}`}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    onClick={() => document.getElementById("file-input")?.click()}
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Upload files area"
                                >
                                    <PiFileArrowUpFill className="upload-area__icon" aria-hidden="true" />
                                    <h3 className="upload-area__title">
                                        {isDragging ? "Drop files here" : "Drag & drop files here"}
                                    </h3>
                                    <p className="upload-area__subtitle">or click to browse</p>
                                    <p className="upload-area__hint">Supports PDF, TXT (Max 10MB per file)</p>
                                    
                                    <input
                                        id="file-input"
                                        type="file"
                                        multiple
                                        accept=".pdf,.txt,application/pdf,text/plain"
                                        onChange={handleFileInput}
                                        style={{ display: "none" }}
                                    />
                                </div>

                                {uploadedFiles.length > 0 && (
                                    <div className="file-list" role="list" aria-label="Uploaded files">
                                        {uploadedFiles.map((file, index) => (
                                            <div key={`${file.name}-${file.size}`} className="file-item" role="listitem">
                                                <span className="file-item__icon" aria-hidden="true">
                                                    {getFileIcon(file.name)}
                                                </span>
                                                <div className="file-item__info">
                                                    <span className="file-item__name">{file.name}</span>
                                                    <span className="file-item__size">{formatFileSize(file.size)}</span>
                                                </div>
                                                <button
                                                    className="file-item__remove"
                                                    onClick={() => removeFile(index)}
                                                    aria-label={`Remove ${file.name}`}
                                                >
                                                    <PiX aria-hidden="true" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 3: All Set */}
                    {currentStep === 3 && (
                        <div className="setup__step active">
                            <div className="setup__success" aria-hidden="true">
                                <div className="setup__success-icon">
                                    <PiCheckCircleFill />
                                </div>
                            </div>

                            <h2 className="setup__step-title setup__step-title--centered">Review Your Settings</h2>

                            <div className="review-grid">
                                <div className="review-card">
                                    <h3 className="review-card__title">Character & Voice</h3>
                                    <p className="review-card__detail">{selectedAvatar?.name}</p>
                                    <p className="review-card__detail review-card__detail--secondary">
                                        {selectedVoice.label} — {selectedVoice.description}
                                    </p>
                                </div>

                                <div className="review-card">
                                    <h3 className="review-card__title">Documents</h3>
                                    <p className="review-card__detail">
                                        {uploadedFiles.length === 0
                                            ? "No files uploaded"
                                            : `${uploadedFiles.length} ${uploadedFiles.length === 1 ? "file" : "files"} uploaded`}
                                    </p>
                                </div>
                            </div>

                            <div className="setup__field">
                                <label htmlFor="username-input" className="setup__label">
                                    Your Name <span className="setup__label-optional">(Optional)</span>
                                </label>
                                <input
                                    id="username-input"
                                    type="text"
                                    className="setup__input"
                                    placeholder="Enter your name"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="setup__nav" aria-label="Setup navigation">
                    <button
                        className="setup__nav-button setup__nav-button--back"
                        onClick={handleBack}
                        aria-label={currentStep === 1 ? "Go back to home" : "Go to previous step"}
                    >
                        <span aria-hidden="true">←</span>
                        {currentStep === 1 ? "Back to Home" : "Back"}
                    </button>

                    <LiquidButton
                        onClick={handleNext}
                        disabled={!canProceed}
                        aria-label={currentStep === 3 ? "Start learning" : "Go to next step"}
                        size="md"
                    >
                        {currentStep === 3 ? "Start Learning" : "Next"}
                        <span aria-hidden="true">→</span>
                    </LiquidButton>
                </nav>
            </div>
        </section>
    );
};

export default Setup;