import { useDocumentList } from '../useDocumentList';
import { FiFileText, FiTrash2, FiClock, FiCheckCircle, FiXCircle, FiLoader } from 'react-icons/fi';
import { UploadTab } from '../../setup/components/UploadTab';
import './DocumentsPanel.css';

export function DocumentsPanel() {
  const { documents, isLoading, error, deleteDocument, refresh } = useDocumentList();

  const getStatusIcon = (status, stage) => {
    if (stage === 'COMPLETE') {
      return <FiCheckCircle className="status-icon success" />;
    }
    if (stage === 'FAILED') {
      return <FiXCircle className="status-icon error" />;
    }
    if (stage === 'CANCELLED') {
      return <FiXCircle className="status-icon cancelled" />;
    }
    if (stage === 'QUEUED') {
      return <FiClock className="status-icon pending" />;
    }
    return <FiLoader className="status-icon spinning" />;
  };

  const getStatusText = (stage, progress_pct) => {
    if (stage === 'COMPLETE') {
      return 'Ready';
    }
    if (stage === 'FAILED') {
      return 'Failed';
    }
    if (stage === 'CANCELLED') {
      return 'Cancelled';
    }
    if (stage === 'QUEUED') {
      return 'Queued...';
    }
    return `${stage || 'Processing'} (${progress_pct || 0}%)`;
  };

  if (isLoading && documents.length === 0) {
    return <div className="documents-panel-loading">Loading documents...</div>;
  }

  return (
    <div className="documents-panel-container">
      <div className="documents-panel">
        <UploadTab onUploaded={refresh} />
      </div>

      <div className="documents-panel list-panel">
        <div className="documents-panel-header">
          <h3>Knowledge Base</h3>
          <span className="badge">{documents.length} Files</span>
        </div>

      {error && <div className="error-banner">{error}</div>}

      {documents.length === 0 ? (
        <div className="empty-state">
          <FiFileText size={48} />
          <p>No documents uploaded yet.</p>
        </div>
      ) : (
        <ul className="document-list">
          {documents.map((doc) => (
            <li key={doc.id} className={`document-item ${doc.current_stage?.toLowerCase()}`}>
              <div className="doc-icon">
                <FiFileText size={24} />
              </div>
              <div className="doc-info">
                <div className="doc-name" title={doc.filename}>
                  {doc.filename}
                </div>
                <div className="doc-meta">
                  <span className="doc-status">
                    {getStatusIcon(doc.status, doc.current_stage)}
                    {getStatusText(doc.current_stage, doc.progress_pct)}
                  </span>
                  <span className="doc-date">{new Date(doc.upload_date).toLocaleDateString()}</span>
                </div>
              </div>
              <button
                className="icon-button delete"
                onClick={() => deleteDocument(doc.id)}
                title="Delete document"
              >
                <FiTrash2 />
              </button>
              {/* If processing, we could show a tiny progress bar */}
              {!['COMPLETE', 'FAILED', 'CANCELLED', 'QUEUED'].includes(doc.current_stage) && (
                <div className="mini-progress-bar">
                  <div
                    className="mini-progress-fill"
                    style={{ width: `${doc.progress_pct || 0}%` }}
                  ></div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
