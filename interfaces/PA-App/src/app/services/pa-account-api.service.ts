import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ApiService } from './api.service';
import { JwtService } from './jwt.service';

@Injectable({
  providedIn: 'root'
})
export class PaAccountApiService {
  constructor(
    private apiService: ApiService,
    private jwtService: JwtService
  ) { }

  create(username: string, password: string): Observable<any> {
    console.log('PaAccountApiService : login()');

    return this.apiService
      .post(
        environment.url_pa_account_service_api,
        '/user',
        {
          username,
          password
        },
        true
      )
      .pipe(
        tap(response => console.log('response: ', response)),
        map(response => {
          const user = response.user;

          if (user && user.token) {
            this.jwtService.saveToken(user.token);
          }
        })
      );
  }

  store(type: string, data: string): Observable<any> {
    console.log('PaAccountApiService : storeData()');

    return this.apiService
      .post(
        environment.url_pa_account_service_api,
        '/data-storage',
        {
          type,
          data
        },
        false
      )
      .pipe(
        tap(response => console.log('response: ', response)),
        map(response => response)
      );
  }

  retrieve(type: string): Observable<any> {
    console.log('PaAccountApiService : retrieveData()');

    return this.apiService
      .get(
        environment.url_pa_account_service_api,
        '/data-storage',
      )
      .pipe(
        tap(response => console.log('response: ', response)),
        map(response => response)
      );
  }

  login(username: string, password: string): Observable<any> {
    console.log('PaAccountApiService : login()');

    return this.apiService
      .post(
        environment.url_pa_account_service_api,
        '/user/login',
        {
          username,
          password
        },
        true
      )
      .pipe(
        tap(response => console.log('response: ', response)),
        map(response => {
          const user = response.user;

          if (user && user.token) {
            this.jwtService.saveToken(user.token);
          }
        })
      );
  }
}
