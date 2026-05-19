import { Navigate } from 'react-router-dom';
import { getDefaultRoute } from '../lib/defaultRoute.js';

export default function ProtectedRoute({ user, perm, anyPerm, children }) {
  if (user.role === 'admin') return children;
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
