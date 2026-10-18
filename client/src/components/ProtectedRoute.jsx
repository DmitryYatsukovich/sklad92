import { Navigate } from 'react-router-dom';
import { getDefaultRoute } from '../lib/defaultRoute.js';
import { hasAdminPermissionBypass } from '../lib/adminAccess.js';

export default function ProtectedRoute({ user, perm, anyPerm, children }) {
  if (hasAdminPermissionBypass(user)) return children;
  if (anyPerm?.length) {
    if (!anyPerm.some((p) => user[p])) {
      return <Navigate to={getDefaultRoute(user)} replace />;
    }
    return children;
  }
  if (perm && !user[perm]) {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }
  return children;
}
