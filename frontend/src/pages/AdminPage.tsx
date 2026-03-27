import { useEffect, useState, useMemo } from "react";
import { Pencil, Trash2, UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, assertOk } from "@/lib/api";

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string | null;
  role_id: string | null;
  is_active: boolean;
}

interface AddUserForm {
  name: string;
  email: string;
  password: string;
  role_id: string;
}

interface EditUserForm {
  name: string;
  role_id: string;
  is_active: boolean;
  password: string;
}

const AdminPage = () => {
  const [activeTab, setActiveTab] = useState<"users" | "rules">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form states
  const [addForm, setAddForm] = useState<AddUserForm>({
    name: "",
    email: "",
    password: "",
    role_id: "",
  });
  const [editForm, setEditForm] = useState<EditUserForm>({
    name: "",
    role_id: "",
    is_active: true,
    password: "",
  });
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    loadUsers();
    loadRoles();
  }, []);

  const loadUsers = async () => {
    try {
      const res = await api.get("/admin/users");
      await assertOk(res);
      const data: User[] = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setIsLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      const res = await api.get("/admin/roles");
      await assertOk(res);
      const data: Role[] = await res.json();
      setRoles(data);
    } catch {
      // Silently fail - roles will show as empty
    }
  };

  const handleAddUser = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.post("/admin/users", addForm);
      await assertOk(res);
      setAddDialogOpen(false);
      setAddForm({ name: "", email: "", password: "", role_id: "" });
      await loadUsers();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        name: editForm.name,
        role_id: editForm.role_id,
        is_active: editForm.is_active,
      };
      if (editForm.password) {
        body.password = editForm.password;
      }
      const res = await api.patch(`/admin/users/${editingUser.id}`, body);
      await assertOk(res);
      setEditDialogOpen(false);
      setEditingUser(null);
      setEditForm({ name: "", role_id: "", is_active: true, password: "" });
      await loadUsers();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const res = await api.delete(`/admin/users/${id}`);
      if (res.ok) {
        setUsers(users.filter((u) => u.id !== id));
      }
    } catch {
      // Error already handled by API
    }
    setDeleteConfirmId(null);
  };

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setEditForm({
      name: user.name,
      role_id: user.role_id || "",
      is_active: user.is_active,
      password: "",
    });
    setEditDialogOpen(true);
  };

  const getRoleBadgeClass = (roleName: string | null) => {
    if (!roleName) return "text-muted-foreground";
    switch (roleName) {
      case "Admin":
        return "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-purple-200 text-purple-900";
      case "reviewer":
        return "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-200 text-blue-900";
      case "uploader":
        return "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-200 text-slate-700";
      default:
        return "text-muted-foreground";
    }
  };

  const getStatusBadgeClass = (isActive: boolean) => {
    return isActive
      ? "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-green-200 text-green-900"
      : "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-200 text-slate-600";
  };

  // Get unique roles for filter
  const uniqueRoles = useMemo(() => {
    const roleNames = users.map((u) => u.role).filter((r): r is string => r !== null);
    return Array.from(new Set(roleNames)).sort();
  }, [users]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    let result = [...users];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query)
      );
    }

    // Role filter
    if (roleFilter !== "all") {
      result = result.filter((u) => u.role === roleFilter);
    }

    // Status filter
    if (statusFilter !== "all") {
      const isActive = statusFilter === "active";
      result = result.filter((u) => u.is_active === isActive);
    }

    return result;
  }, [users, searchQuery, roleFilter, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex h-14 items-center justify-between border-b border-border px-6">
          <h1 className="text-sm font-semibold text-foreground">Admin</h1>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <h1 className="text-sm font-semibold text-foreground">Admin</h1>
        {activeTab === "users" && (
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="size-3.5 mr-2" />
            Add User
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-6">
        <button
          onClick={() => setActiveTab("users")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "users"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setActiveTab("rules")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "rules"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Workflow Rules
        </button>
      </div>

      {/* Toolbar strip - only for Users tab */}
      {activeTab === "users" && (
        <div className="shrink-0 flex items-center gap-3 border-b border-border px-4 py-2">
          <div className="relative w-80">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 focus-visible:ring-0 focus-visible:border-primary"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {uniqueRoles.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[100px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {error && (
          <p className="text-sm text-destructive px-6 py-4">{error}</p>
        )}

        {activeTab === "users" && (
          <>
            {/* Column header - fixed */}
            <div className="shrink-0 grid grid-cols-[1fr_1fr_120px_100px_100px] items-center gap-4 border-b border-border bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Name</span>
              <span>Email</span>
              <span>Role</span>
              <span>Status</span>
              <span>Actions</span>
            </div>

            {/* Scrollable rows */}
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col">
                {filteredUsers.map((user) => (
                  <div
                    key={user.id}
                    className="grid grid-cols-[1fr_1fr_120px_100px_100px] items-center gap-4 border-b border-border bg-background px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors"
                  >
                    <span className="font-medium text-foreground">{user.name}</span>
                    <span className="text-muted-foreground">{user.email}</span>
                    <span>
                      {user.role ? (
                        <span className={getRoleBadgeClass(user.role)}>{user.role}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                    <span>
                      <span className={getStatusBadgeClass(user.is_active)}>
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      {deleteConfirmId === user.id ? (
                        <>
                          <span className="text-xs text-muted-foreground mr-1">Sure?</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteUser(user.id)}
                          >
                            <span className="text-xs font-medium">Yes</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            <span className="text-xs">No</span>
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => openEditDialog(user)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteConfirmId(user.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === "rules" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center text-center">
              <p className="text-sm font-medium text-foreground">Workflow Rules</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage workflow routing rules — coming soon
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Add User</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="add-name" className="text-xs">Full Name</Label>
              <Input
                id="add-name"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="John Doe"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-email" className="text-xs">Email</Label>
              <Input
                id="add-email"
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-password" className="text-xs">Password</Label>
              <Input
                id="add-password"
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                placeholder="Min 8 characters"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-role" className="text-xs">Role</Label>
              <Select
                value={addForm.role_id}
                onValueChange={(value) => setAddForm({ ...addForm, role_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {submitError && (
            <p className="text-xs text-destructive">{submitError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddUser} disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Edit User</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name" className="text-xs">Full Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-role" className="text-xs">Role</Label>
              <Select
                value={editForm.role_id}
                onValueChange={(value) => setEditForm({ ...editForm, role_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-status" className="text-xs">Status</Label>
              <Select
                value={editForm.is_active ? "active" : "inactive"}
                onValueChange={(value) => setEditForm({ ...editForm, is_active: value === "active" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-password" className="text-xs">New Password (optional)</Label>
              <Input
                id="edit-password"
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Leave blank to keep current"
              />
              <p className="text-[10px] text-muted-foreground">
                Only fill this if you want to reset the password
              </p>
            </div>
          </div>
          {submitError && (
            <p className="text-xs text-destructive">{submitError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditUser} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPage;
