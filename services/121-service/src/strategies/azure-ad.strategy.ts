import {
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PassportStrategy } from '@nestjs/passport';
import { BearerStrategy } from 'passport-azure-ad';
import { AuthenticatedUserParameters } from '../guards/authenticated-user.decorator';
import { UserType } from '../user/user-type-enum';
import { UserRO, UserToken } from '../user/user.interface';
import { UserService } from '../user/user.service';
import { generateRandomString } from '../utils/getRandomValue.helper';

const config = {
  credentials: {
    tenantID: process.env.AZURE_ENTRA_TENANT_ID,
    clientID: process.env.AZURE_ENTRA_CLIENT_ID,
    audience: `api://${process.env.AZURE_ENTRA_CLIENT_ID}`,
  },
  metadata: {
    authority: 'login.microsoftonline.com',
    discovery: '.well-known/openid-configuration',
    version: 'v2.0',
  },
  settings: {
    // TODO: Probably should be set to true in production
    validateIssuer: false,
    passReqToCallback: true,
    loggingLevel: 'error',
  },
};
const EXPOSED_SCOPES = ['User.read']; //provide a scope of your azure AD

@Injectable()
export class AzureAdStrategy
  extends PassportStrategy(BearerStrategy, 'azure-ad')
  implements OnModuleInit
{
  private userService: UserService;
  constructor(private moduleRef: ModuleRef) {
    super({
      identityMetadata: `https://${config.metadata.authority}/${config.credentials.tenantID}/${config.metadata.version}/${config.metadata.discovery}`,
      issuer: `https://${config.metadata.authority}/${config.credentials.tenantID}/${config.metadata.version}`,
      clientID: config.credentials.clientID,
      audience: config.credentials.audience,
      validateIssuer: config.settings.validateIssuer,
      passReqToCallback: config.settings.passReqToCallback,
      loggingLevel: config.settings.loggingLevel,
      scope: EXPOSED_SCOPES,
      loggingNoPII: false,
    });
  }

  async onModuleInit(): Promise<void> {
    const contextId = ContextIdFactory.create();
    this.userService = await this.moduleRef.resolve(UserService, contextId, {
      strict: false,
    });
  }

  async validate(request: any, payload: any): Promise<any> {
    if (!payload) {
      throw new UnauthorizedException();
    }

    let user: UserRO;
    const username = payload.email;
    const authParams =
      request.authenticationParameters as AuthenticatedUserParameters;

    // This is an early return to allow the guard to be at the top of the controller and the decorator at the specific endpoints we want to protect.
    if (!authParams?.isGuarded) {
      return true;
    }

    try {
      // Try to find user by username (this is an email address in our case)
      user = await this.userService.findByUsernameOrThrow(username);
      if (!user.user.isEntraUser) {
        user = await this.userService.updateUser({
          id: user.user.id,
          isEntraUser: true,
        });
      }
    } catch (error: Error | unknown) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.NOT_FOUND
      ) {
        // If this user is not found, create a new user
        const password = generateRandomString(16);
        user = await this.userService.create(
          username,
          password,
          UserType.aidWorker,
          true,
        );
      } else {
        throw error;
      }
    }

    if (authParams.permissions) {
      if (!request.params.programId) {
        throw new HttpException(
          'Endpoint is missing programId parameter',
          HttpStatus.BAD_REQUEST,
        );
      }
      const hasPermission = await this.userService.canActivate(
        authParams.permissions,
        request.params.programId,
        user.user.id,
      );
      if (!hasPermission) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
    } else if (authParams.isAdmin) {
      if (!user.user.isAdmin) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
    }

    const userToken: UserToken = {
      id: user.user.id,
      username: user.user.username,
      exp: payload.exp,
      admin: user.user.isAdmin,
    };
    return userToken;
  }
}
