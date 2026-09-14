export interface IRegisterPayload {
  agencyName: string;
  agencyPhone?: string;
  name: string;
  email: string;
  password: string;
}

export interface ILoginPayload {
  email: string;
  password: string;
}

export interface IChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface IUpdateMePayload {
  name: string;
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  sessionToken: string;
}
