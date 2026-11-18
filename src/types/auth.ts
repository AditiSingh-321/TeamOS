export interface AuthProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
}

export interface AuthFormState {
  error?: string;
  message?: string;
}
