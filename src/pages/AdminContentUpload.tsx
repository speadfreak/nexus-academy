// The standalone content-upload page moved into the /admin control center
// (Content tab). This route now redirects so old links keep working.

import { Navigate } from "react-router";

export default function AdminContentUpload() {
  return <Navigate to="/admin?tab=content" replace />;
}
