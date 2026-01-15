import { useAuthContext } from "@/context/AuthContext";

// Thin wrapper so existing code can keep using useAuth()
export function useAuth() {
  return useAuthContext();
}

