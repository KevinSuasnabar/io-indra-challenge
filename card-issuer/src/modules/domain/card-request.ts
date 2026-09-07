import { CardRequestStatusEnum } from '../../constants/card-request-status.enum';

export type DocumentType = 'DNI';
export type ProductType = 'VISA';
export type Currency = 'PEN' | 'USD';

export interface Customer {
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  age: number;
  email: string;
}

export interface Product {
  type: ProductType;
  currency: Currency;
}

export interface CardIssuancePayload {
  customer: Customer;
  product: Product;
  forceError: boolean;
}

export type CardRequestStatus = CardRequestStatusEnum;

export interface CardRequest {
  requestId: string;
  documentNumber: string;
  status: CardRequestStatus;
  payload: CardIssuancePayload;
  createdAt: string;
  updatedAt: string;
  failureReason: string | null;
  failureAttempts: number | null;
}

export interface CardRequestListItem {
  requestId: string;
  documentNumber: string;
  status: CardRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CardRequestListResult {
  items: CardRequestListItem[];
  nextCursor: string | null;
}