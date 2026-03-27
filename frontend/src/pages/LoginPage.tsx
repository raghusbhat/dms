import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BrandGraphic = () => (
  <svg
    aria-hidden="true"
    className="absolute inset-0 h-full w-full"
    viewBox="0 0 400 800"
    preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Large filled circle — bleeds out of bottom-left */}
    <circle cx="-60" cy="820" r="340" fill="white" fillOpacity="0.09" />

    {/* Medium filled circle — bleeds out of top-right */}
    <circle cx="460" cy="-60" r="260" fill="white" fillOpacity="0.07" />

    {/* Ring — mid-right, adds mid-ground depth */}
    <circle
      cx="430"
      cy="460"
      r="160"
      fill="none"
      stroke="white"
      strokeWidth="48"
      strokeOpacity="0.06"
    />

    {/* Small filled circle — upper-left accent */}
    <circle cx="55" cy="170" r="72" fill="white" fillOpacity="0.07" />
  </svg>
);

const REMEMBER_ME_KEY = "dms_remember_email";

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const savedEmail = localStorage.getItem(REMEMBER_ME_KEY) ?? "";
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(savedEmail !== "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password, rememberMe);
      if (rememberMe) {
        localStorage.setItem(REMEMBER_ME_KEY, email);
      } else {
        localStorage.removeItem(REMEMBER_ME_KEY);
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">

      {/* Brand panel
          Mobile : compact top bar — logo only, fixed height
          Desktop: left 40% panel — logo + tagline centered */}
      <div className={cn(
        "relative flex items-center justify-center overflow-hidden bg-primary",
        "h-16 px-6",
        "lg:h-auto lg:w-2/5 lg:flex-col lg:gap-4 lg:px-12 lg:py-0"
      )}>
        <BrandGraphic />

        {/* Content sits above the SVG */}
        <div className="relative z-10 flex items-center gap-3 lg:flex-col lg:gap-4 lg:text-center">
          <img
            src="/logo.svg"
            alt="DMS"
            className="h-8 w-auto brightness-0 invert lg:h-16"
          />
          <p className="hidden lg:block text-base font-medium text-primary-foreground/80 tracking-wide uppercase">
            Document Management System
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className={cn(
        "flex flex-1 flex-col items-center justify-center px-6 py-10",
        "bg-gray-100",
        "lg:py-0 lg:px-8"
      )}>
        <div className={cn(
          "w-full max-w-sm flex flex-col gap-6",
          "lg:p-6",
        )}>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Use your account credentials to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className={cn(
                    "absolute inset-y-0 right-0 flex items-center px-3",
                    "text-muted-foreground hover:text-foreground transition-colors"
                  )}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">
                Remember me
              </Label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
