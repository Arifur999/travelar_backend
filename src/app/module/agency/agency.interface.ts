/** The contact email is not here: it is fixed at registration. */
export interface IUpdateAgencyProfilePayload {
  name?: string;
  /** Null clears the column; undefined leaves it alone. */
  phone?: string | null;
  address?: string | null;
  logo?: string | null;
}
