import { Link } from "react-router-dom";

import { EmptyState } from "../components/ui";

export default function NotFound() {
  return (
    <div className="card">
      <EmptyState
        title="Page not found"
        description="This page doesn't exist."
        action={
          <Link to="/" className="btn-primary">
            Back to overview
          </Link>
        }
      />
    </div>
  );
}
