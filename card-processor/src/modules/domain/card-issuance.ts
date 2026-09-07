import { CardProcessingStatusEnum } from '../../constants/card-processing-status.enum';

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

//payload de negocio
export interface CardIssuancePayload {
  customer: Customer;
  product: Product;
  forceError: boolean;
}

export interface CardDetails {
  number: string;
  expiry: string;
  cvv: string;
}

export type CardIssuanceStatus = CardProcessingStatusEnum;

export interface CardIssuance {
  requestId: string;
  documentNumber: string;
  card: CardDetails | null;
  status: CardIssuanceStatus;
  createdAt: string;
  updatedAt: string;
}
