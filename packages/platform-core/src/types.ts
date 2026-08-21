export type PlatformUser = {
  id: string;
  email: string;
  name?: string;
  spaceId: string | null;
  currentSpaceId?: string;
  logoUrl?: string | null;
  createdAt?: string;
};

export type PlatformSpace = {
  id: string;
  name: string;
  address?: string;
  logoUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Present when the app DB has product columns; platform does not require them. */
  kind?: string;
  clientProfileType?: string;
  firmStatus?: string | null;
};

export type PlatformUserSpace = {
  id: string;
  userId: string;
  spaceId: string;
  isAdmin?: boolean;
  role?: string;
  space?: PlatformSpace;
  createdAt?: string;
};
