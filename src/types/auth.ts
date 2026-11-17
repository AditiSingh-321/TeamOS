export interface AuthProfile {
  name: string;
  email: string;
  initials: string;
}

export interface AuthFormState {
  error?: string;
  message?: string;
}
