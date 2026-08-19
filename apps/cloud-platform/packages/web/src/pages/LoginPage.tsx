import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { BrandSplash } from "@/components/BrandSplash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAccessToken } from "@/lib/auth";
import { checkAuthStatus, fetchAuthMe, loginUser } from "@/lib/api";
import { loadSession, saveSession } from "@/lib/session";

async function hydrateSessionFromToken(token: string): Promise<void> {
  const user = await fetchAuthMe(token);
  saveSession({
    token,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userRole: "admin",
    isSystemAdmin: true,
    mustChangePassword: false,
    projectId: null,
    projectName: null,
  });
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const session = loadSession();
      if (session) {
        navigate(session.projectId ? `/projects/${session.projectId}/tasks` : "/projects", {
          replace: true,
        });
        return;
      }
      try {
        const status = await checkAuthStatus();
        if (cancelled) {
          return;
        }
        if (status.mode === "local" && !status.hasUsers) {
          navigate("/setup", { replace: true });
          return;
        }
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Auth status failed");
          setReady(true);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await loginUser({ email, password });
      setAccessToken(result.token);
      await hydrateSessionFromToken(result.token);
      navigate("/projects", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  if (!ready && error.length === 0) {
    return <BrandSplash title="Lotaru" subtitle="Loading…" />;
  }

  return (
    <div className="flex h-full items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-white/[0.08] bg-card shadow-2xl">
        <CardHeader className="space-y-6 text-center">
          <div className="flex justify-center">
            <BrandMark />
          </div>
          <div>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>Email and password</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                autoComplete="username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="current-password"
              />
            </div>
            {error ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              First time? <Link className="underline" to="/setup">Create admin</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
