export default function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label="Loading">
      <div className="loader" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}