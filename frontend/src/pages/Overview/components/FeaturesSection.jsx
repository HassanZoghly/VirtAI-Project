import FeatureItem from './FeatureItem';
import { features } from '../data/features';

function FeaturesSection() {
  return (
    <section className="features" aria-label="Key features">
      <div className="features__header">
        <h2 className="features__heading">What makes it different</h2>
        <p className="features__sub">
          Built around the real pipeline — streaming, retrieval, voice, and a live avatar — not a chatbot wrapper.
        </p>
      </div>
      
      <div className="features__grid">
        {features.map((f) => (
          <FeatureItem key={f.id} {...f} />
        ))}
      </div>
    </section>
  );
}

export default FeaturesSection;