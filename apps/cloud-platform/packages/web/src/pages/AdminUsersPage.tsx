import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/useSession";
import { fetchUsers, createAppUser, deleteAppUser, type PublicUser } from "@/lib/api";

export function AdminUsersPage() {
  const session = useSession();

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const loadUsers = useCallback(async () => {
    if (!session) return;
    try {
      setLoading(true);
      setUsers(await fetchUsers(session));
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setAddError("");
    setAdding(true);
    try {
      const user = await createAppUser(session, {
        name: newName,
        email: newEmail,
        password: newPassword,
      });
      setUsers((prev) => prev.concat([user]));
      setAddOpen(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      toast.success("User created");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(userId: string, name: string) {
    if (!session) return;
    if (!confirm(`Remove ${name}? This cannot be undone.`)) return;
    try {
      await deleteAppUser(session, userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove user");
    }
  }

  if (!session) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Team members"
        subtitle="Everyone who can sign in has full access to the workspace"
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Add member
              </Button>
            </DialogTrigger>
            <DialogContent className="border-white/[0.08] bg-[#111111]">
              <DialogHeader>
                <DialogTitle>Add team member</DialogTitle>
              </DialogHeader>
              <form onSubmit={(e) => void handleAdd(e)} className="space-y-4 pt-2">
                <div className="grid gap-2">
                  <Label>Full name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Jane Smith"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="jane@example.com"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                    minLength={6}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  New members get full access to every project and setting.
                </p>

                {addError ? (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {addError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={adding}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {adding ? "Creating…" : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="panel-card p-10 text-center text-sm text-muted-foreground">
            No team members yet. Add one to get started.
          </div>
        ) : (
          <div className="panel-card divide-y divide-white/[0.06] overflow-hidden">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold uppercase text-primary">
                      {user.name.charAt(0)}
                    </div>
                    <span className="truncate font-medium text-white">{user.name}</span>
                    {user.id === session.userId ? (
                      <Badge variant="outline">You</Badge>
                    ) : null}
                  </div>
                  <p className="truncate pl-10 text-sm text-muted-foreground">{user.email}</p>
                </div>

                <div className="ml-4 flex shrink-0 items-center gap-3">
                  <Badge variant="default">Full access</Badge>
                  {user.id !== session.userId ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDelete(user.id, user.name)}
                      title="Remove user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
