import { Injectable } from '@angular/core';
import { CapacitorHttp } from '@capacitor/core';
import { from, Observable, tap } from 'rxjs';
import { environment } from 'src/environments/environment';
import { v4 as uuidv4 } from 'uuid';

@Injectable({
  providedIn: 'root'
})
export class AeropayService {
  private merchantToken: string | null = null;
  private merchantTokenExpiry: number = 0;
  private usedForMerchantToken: string | null = null;
  private usedForMerchantTokenExpiry: number = 0;

  constructor() {}

  private async httpPost(url: string, data: any, token?: string, extraHeaders?: Record<string, string>): Promise<any> {
    const headers: any = {
      'Content-Type': 'application/json',
      'accept': 'application/json',
      ...(token ? { 'authorization': `Bearer ${token}` } : {}),
      ...(extraHeaders || {})
    };

    const options: any = {
      url: url,
      headers: headers,
      data: data,
    };

    return CapacitorHttp.post(options);
  }

  private async httpGet(url: string, token?: string): Promise<any> {
    const options: any = {
      url: url,
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
        ...(token ? { 'authorization': `Bearer ${token}` } : {})
      }
    };
    return CapacitorHttp.get(options);
  }

  fetchMerchantToken(): Observable<any> {
    const payload = {
      scope: 'merchant',
      apiKey: environment.aeropay_api_key,
      apiSecret: environment.aeropay_api_secret,
      id: environment.aeropay_merchant_id
    };
    return from(this.httpPost(`${environment.aeropay_url}/v2/token`, payload)).pipe(
      tap(response => {
        if (response.data?.token) {
          this.setMerchantToken(response.data.token, response.data.TTL);
        }
      })
    );
  }

  fetchUsedForMerchantToken(userId: string): Observable<any> {
    const payload = {
      scope: 'userForMerchant',
      apiKey: environment.aeropay_api_key,
      apiSecret: environment.aeropay_api_secret,
      id: environment.aeropay_merchant_id,
      userId: userId
    };
    return from(this.httpPost(`${environment.aeropay_url}/v2/token`, payload)).pipe(
      tap(response => {
        if (response.data?.token) {
          this.setUsedForMerchantToken(response.data.token, response.data.TTL);
        }
      })
    );
  }

  createUser(userData: { firstName: string; lastName: string; phoneNumber: string; email: string }): Observable<any> {
    return from(this.httpPost(`${environment.aeropay_url}/v2/user`, userData, this.getMerchantToken() || ''));
  }

  confirmUser(userId: string, code: string): Observable<any> {
    const payload = {
      userId,
      code,
      merchantId: environment.aeropay_merchant_id
    };
    return from(this.httpPost(`${environment.aeropay_url}/v2/confirmUser`, payload, this.getMerchantToken() || ''));
  }

  getBankAccounts(): Observable<any> {
    return from(this.httpGet(`${environment.aeropay_url}/v2/bankAccounts`, this.getUsedForMerchantToken() || ''));
  }

  getAerosyncCredentials(): Observable<any> {
    return from(this.httpGet(`${environment.aeropay_url}/v2/aggregatorCredentials?aggregator=aerosync`, this.getUsedForMerchantToken() || ''));
  }

  linkBankAccount(connectionId: string): Observable<any> {
    const payload = {
      connectionId,
      aggregator: 'aerosync'
    };
    return from(this.httpPost(`${environment.aeropay_url}/v2/linkAccountFromAggregator`, payload, this.getUsedForMerchantToken() || ''));
  }

  createPreauthTransaction(amountInPennies: number, bankAccountId: string | number): Observable<any> {
    const payload = {
      amount: { currency: 'USD', amount: amountInPennies },
      merchantId: environment.aeropay_merchant_id,
      bankAccountId
    };
    return from(this.httpPost(
      `${environment.aeropay_url}/v2/preauthTransaction`,
      payload,
      this.getUsedForMerchantToken() || '',
      { 'Idempotency-Key': uuidv4() }
    ));
  }

  capturePreauthTransaction(preauthTransactionId: string): Observable<any> {
    const payload = { id: preauthTransactionId };
    return from(this.httpPost(`${environment.aeropay_url}/v2/capturePreauthTransaction`, payload, this.getMerchantToken() || ''));
  }

  setMerchantToken(token: string, ttl: number): void {
    this.merchantToken = token;
    // Subtract 30s buffer so we refresh slightly before true expiry
    this.merchantTokenExpiry = Date.now() + (ttl * 1000) - 30_000;
  }

  getMerchantToken(): string | null {
    return this.merchantToken;
  }

  isMerchantTokenValid(): boolean {
    return this.merchantToken !== null && Date.now() < this.merchantTokenExpiry;
  }

  setUsedForMerchantToken(token: string, ttl: number): void {
    this.usedForMerchantToken = token;
    this.usedForMerchantTokenExpiry = Date.now() + (ttl * 1000) - 30_000;
  }

  getUsedForMerchantToken(): string | null {
    return this.usedForMerchantToken;
  }

  isUsedForMerchantTokenValid(): boolean {
    return this.usedForMerchantToken !== null && Date.now() < this.usedForMerchantTokenExpiry;
  }

}
