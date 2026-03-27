const BASE_URL = "http://localhost:8000";

type RequestBody = Record<string, unknown> | undefined;

// Thrown for both network failures and non-OK HTTP responses.
// Always carries a message safe to show directly to the user.
export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Maps an HTTP response to a user-friendly message.
// 5xx → generic; 422 → generic; 4xx → backend detail if it's a plain string.
const toUserMessage = async (res: Response): Promise<string> => {
  if (res.status >= 500) {
    return "Something went wrong on our end. Please try again later.";
  }
  if (res.status === 422) {
    return "Please check your input and try again.";
  }
  try {
    const data = await res.json();
    if (typeof data.detail === "string" && data.detail.length < 200) {
      return data.detail;
    }
  } catch {
    // response body wasn't JSON — fall through to default
  }
  return "An unexpected error occurred. Please try again.";
};

const request = async (
  method: string,
  path: string,
  body?: RequestBody,
): Promise<Response> => {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network failure — server unreachable, DNS failure, etc.
    throw new ApiError(
      "Unable to reach the server. Check your connection and try again.",
    );
  }
  return res;
};

const refreshAuth = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
};

const isAuthPath = (path: string) =>
  path.includes("/auth/login") || path.includes("/auth/refresh");

// Convenience: throws ApiError if response is not ok.
export const assertOk = async (res: Response): Promise<void> => {
  if (!res.ok) {
    throw new ApiError(await toUserMessage(res), res.status);
  }
};

export const api = {
  get: async (path: string) => {
    let res = await request("GET", path);
    if (res.status === 401 && !isAuthPath(path)) {
      const refreshed = await refreshAuth();
      if (refreshed) {
        res = await request("GET", path);
      }
    }
    return res;
  },
  post: async (path: string, body?: RequestBody) => {
    let res = await request("POST", path, body);
    if (res.status === 401 && !isAuthPath(path)) {
      const refreshed = await refreshAuth();
      if (refreshed) {
        res = await request("POST", path, body);
      }
    }
    return res;
  },
  patch: async (path: string, body?: RequestBody) => {
    let res = await request("PATCH", path, body);
    if (res.status === 401 && !isAuthPath(path)) {
      const refreshed = await refreshAuth();
      if (refreshed) {
        res = await request("PATCH", path, body);
      }
    }
    return res;
  },
  delete: async (path: string) => {
    let res = await request("DELETE", path);
    if (res.status === 401 && !isAuthPath(path)) {
      const refreshed = await refreshAuth();
      if (refreshed) {
        res = await request("DELETE", path);
      }
    }
    return res;
  },
};
