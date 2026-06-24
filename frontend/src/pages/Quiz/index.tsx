import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LectureMultiSelect } from './LectureMultiSelect';
import { toast } from '@/shared/utils/toast';
import styles from './Quiz.module.css';

export default function QuizPage() {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleStartQuiz = () => {
    console.info('Selected lecture IDs for Quiz:', selectedIds);
    toast.info('Quiz generation will be implemented next', 3000);
  };

  /* TODO: Analytics - Knowledge-Gap Heatmap */
  /* TODO: Analytics - Confidence Bars */
  /* TODO: Analytics - RAG-Failure Chart */
  /* TODO: Analytics - Dashboard Wrapper */

  return (
    <div className="classroom-shell" style={{ width: '100%', height: '100%', display: 'flex', backgroundColor: 'var(--bg-primary, #111111)' }}>
      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', overflowY: 'auto' }}>
          <div className={styles.quizCardContainer}>
            <h1 className={styles.quizTitle}>Take a Quiz</h1>
            <p className={styles.quizSubtitle}>Pick one or more lectures to generate questions from.</p>
            
            <div className={styles.selectContainer}>
              <LectureMultiSelect selectedIds={selectedIds} onChange={setSelectedIds} />
            </div>

            <button 
              className={styles.quizStartBtn}
              onClick={handleStartQuiz}
              disabled={selectedIds.length === 0}
            >
              Start Quiz
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
