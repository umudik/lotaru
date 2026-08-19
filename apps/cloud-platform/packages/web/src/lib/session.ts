export type Session = {
  token: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: "admin";
  isSystemAdmin: true;
  mustChangePassword: boolean;
  projectId: string | null;
  projectName: string | null;
};

const KEY = "lotaru.session.v1";

const LOCAL_SESSION: Session = {
  token: "local",
  userId: "lotaru-local",
  userName: "Lotaru",
  userEmail: "local@lotaru",
  userRole: "admin",
  isSystemAdmin: true,
  mustChangePassword: false,
  projectId: null,
  projectName: null,
};

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return LOCAL_SESSION;
    }
    const parsed = JSON.parse(raw) as Session;
    return {
      token: LOCAL_SESSION.token,
      userId: LOCAL_SESSION.userId,
      userName: LOCAL_SESSION.userName,
      userEmail: LOCAL_SESSION.userEmail,
      userRole: "admin",
      isSystemAdmin: true,
      mustChangePassword: false,
      projectId: parsed.projectId,
      projectName: parsed.projectName,
    };
  } catch {
    return LOCAL_SESSION;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function setSelectedProject(projectId: string, projectName: string) {
  const current = loadSession();
  saveSession(Object.assign({}, current, { projectId, projectName }));
}

export function clearSelectedProject() {
  const current = loadSession();
  saveSession(Object.assign({}, current, { projectId: null, projectName: null }));
}
