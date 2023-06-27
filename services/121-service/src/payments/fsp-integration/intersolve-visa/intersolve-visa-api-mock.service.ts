/* eslint-disable @typescript-eslint/no-var-requires */
import { Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import {
  IntersolveCreateCustomerResponseBodyDto,
  IntersolveLinkWalletCustomerResponseDto,
} from './dto/intersolve-create-customer-response.dto';
import { IntersolveCreateCustomerDto } from './dto/intersolve-create-customer.dto';
import { IntersolveCreateDebitCardResponseDto } from './dto/intersolve-create-debit-card.dto';
import {
  IntersolveCreateWalletResponseBodyDto,
  IntersolveCreateWalletResponseDataDto,
  IntersolveCreateWalletResponseDto,
  IntersolveCreateWalletResponseTokenDto,
} from './dto/intersolve-create-wallet-response.dto';
import { IntersolveLoadResponseDto } from './dto/intersolve-load-response.dto';

@Injectable()
export class IntersolveVisaApiMockService {
  public async waitForRandomDelay(): Promise<void> {
    const min = 100;
    const max = 300;
    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, randomNumber));
  }

  public async createCustomerMock(
    payload: IntersolveCreateCustomerDto,
  ): Promise<IntersolveCreateCustomerResponseBodyDto> {
    await this.waitForRandomDelay();
    const res = new IntersolveCreateCustomerResponseBodyDto();
    res.data = {
      success: true,
      errors: [],
      code: 'string',
      correlationId: 'string',
      data: {
        id: `mock-${uuid()}`,
        externalReference: payload.externalReference,
        blocked: false,
        unblockable: false,
        createdAt: '2023-02-08T14:36:05.816Z',
      },
    };
    const lastName = payload.individual.lastName
      ? payload.individual.lastName.toLowerCase()
      : '';

    if (lastName.includes('mock-fail-create-wallet')) {
      // pass different holderId to be later used again in mock issue-token call
      res.data.data.id = 'mock-fail-create-wallet';
    } else if (lastName.includes('mock-fail-link-customer-wallet')) {
      // pass different holderId to be later used again
      res.data.data.id = 'mock-fail-link-customer-wallet';
    } else if (lastName.includes('mock-fail-create-debit-card')) {
      // pass different holderId to be later used again
      res.data.data.id = 'mock-fail-create-debit-card';
    } else if (lastName.includes('mock-fail-load-balance')) {
      // pass different holderId to be later used again
      res.data.data.id = 'mock-fail-load-balance';
    } else if (lastName.includes('mock-fail-create-customer')) {
      res.data.success = false;
      res.data.errors.push({
        code: 'NOT_FOUND',
        field: 'mock field',
        description: 'We mocked that creating customer failed',
      });
      res.status = 404;
      res.statusText = 'NOT_FOUND';
    }
    return res;
  }

  public async createWalletMock(
    holderId: string,
  ): Promise<IntersolveCreateWalletResponseDto> {
    await this.waitForRandomDelay();
    const response = new IntersolveCreateWalletResponseDto();
    response.status = 200;
    response.statusText = 'OK';

    response.data = new IntersolveCreateWalletResponseBodyDto();
    response.data.success = true;
    response.data.errors = [];
    response.data.code = 'string';
    response.data.correlationId = 'string';

    response.data.data = new IntersolveCreateWalletResponseDataDto();
    response.data.data.token = new IntersolveCreateWalletResponseTokenDto();
    response.data.data.token.code = `mock-token-${uuid()}`;
    response.data.data.token.blocked = false;
    response.data.data.token.blockReasonCode = 'string';
    response.data.data.token.tier = 'string';
    response.data.data.token.brandTypeCode = 'string';
    response.data.data.token.holderId = 'string';
    response.data.data.token.balances = [
      {
        quantity: {
          assetCode: 'string',
          value: 0,
          reserved: 0,
        },
        discountBudgetValue: 0,
        lastChangedAt: '2023-02-08T14:36:05.816Z',
      },
    ];
    response.data.data.token.assets = [
      {
        identity: {
          type: 'string',
          subType: 'string',
          code: 'string',
        },
        groupCode: 'string',
        parentAssetCode: 'string',
        name: 'string',
        description: 'string',
        status: 'string',
        minorUnit: 0,
        tags: ['string'],
        conversions: [
          {
            toAssetCode: 'string',
            automatic: true,
            fromQuantity: 0,
            toQuantity: 0,
          },
        ],
        images: [
          {
            code: 'string',
            type: 'string',
            url: 'string',
            description: 'string',
          },
        ],
        vatRegulation: {
          code: 'string',
          value: 0,
        },
        termsAndConditions: {
          url: 'string',
          text: 'string',
        },
        amount: 0,
        currency: 'string',
        articleCode: 'string',
        percentage: 0,
        rank: 0,
        unit: 'string',
        promotionCode: 'string',
        ticket: 'string',
        chargeRestrictions: {
          product: {
            includes: ['string'],
            excludes: ['string'],
          },
          productGroup: {
            includes: ['string'],
            excludes: ['string'],
          },
        },
        allowedMethods: [
          {
            code: 'string',
            period: {
              start: '2023-02-08T14:36:05.817Z',
              end: '2023-02-08T14:36:05.817Z',
            },
            securityCodeInfo: {
              required: true,
              format: 'string',
            },
          },
        ],
      },
    ];

    if (holderId.toLowerCase().includes('mock-fail-link-customer-wallet')) {
      // pass different token to be later used again in mock link-customer-wallet call
      response.data.data.token.code = 'mock-fail-link-customer-wallet';
    }
    if (holderId.toLowerCase().includes('mock-fail-create-debit-card')) {
      // pass different token to be later used again in mock create-debit-card call
      response.data.data.token.code = 'mock-fail-create-debit-card';
    }
    if (holderId.toLowerCase().includes('mock-fail-load-balance')) {
      // pass different token to be later used again in mock load-balance call
      response.data.data.token.code = 'mock-fail-load-balance';
    }

    if (holderId.toLowerCase().includes('mock-fail-create-wallet')) {
      response.data.success = false;
      response.data.errors = [];
      response.data.errors.push({
        code: 'NOT_FOUND',
        field: 'mock field',
        description: 'We mocked that creating wallet failed',
      });
      response.status = 404;
      response.statusText = 'NOT_FOUND';
    }

    return response;
  }

  public async linkCustomerToWalletMock(
    tokenCode: string,
  ): Promise<IntersolveLinkWalletCustomerResponseDto> {
    await this.waitForRandomDelay();

    const res: IntersolveLinkWalletCustomerResponseDto = {
      status: 204,
      statusText: 'No Content',
      data: {},
    };
    if (tokenCode.toLowerCase().includes('mock-fail-link-customer-wallet')) {
      res.data.success = false;
      res.data.errors = [];
      res.data.errors.push({
        code: 'NOT_FOUND',
        field: 'mock field',
        description: 'We mocked that linking wallet to customer failed',
      });
      res.status = 404;
      res.statusText = 'NOT_FOUND';
    }
    return res;
  }

  public async createDebitCardMock(
    tokenCode: string,
  ): Promise<IntersolveCreateDebitCardResponseDto> {
    await this.waitForRandomDelay();

    const res: IntersolveCreateDebitCardResponseDto = {
      status: 200,
      statusText: 'OK',
      data: {},
    };
    if (tokenCode.toLowerCase().includes('mock-fail-create-debit-card')) {
      res.data.success = false;
      res.data.errors = [];
      res.data.errors.push({
        code: 'NOT_FOUND',
        field: 'mock field',
        description: 'We mocked that creating debit card failed',
      });
      res.status = 404;
      res.statusText = 'NOT_FOUND';
    }
    return res;
  }

  public async loadBalanceCardMock(
    tokenCode: string,
  ): Promise<IntersolveLoadResponseDto> {
    await this.waitForRandomDelay();

    const response = {
      data: {
        success: true,
        errors: [],
        code: 'string',
        correlationId: 'string',
        data: {
          balances: [
            {
              quantity: {
                assetCode: 'string',
                value: 0,
                reserved: 0,
              },
              discountBudgetValue: 0,
              lastChangedAt: '2023-02-08T14:37:22.670Z',
            },
          ],
        },
      },
      status: 200,
      statusText: 'OK',
    };
    if (tokenCode.toLowerCase().includes('mock-fail-load-balance')) {
      response.data.success = false;
      response.data.errors.push({
        code: 'NOT_FOUND',
        field: 'mock field',
        description: 'We mocked that the load balance call failed',
      });
      response.status = 404;
      response.statusText = 'NOT FOUND';
    }
    return response;
  }
}
