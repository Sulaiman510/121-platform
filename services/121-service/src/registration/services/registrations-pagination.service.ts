import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FilterOperator,
  paginate,
  Paginated,
  PaginateQuery,
} from 'nestjs-paginate';
import { FilterComparator, parseFilter } from 'nestjs-paginate/lib/filter';
import {
  Brackets,
  FindOperator,
  Repository,
  SelectQueryBuilder,
  WhereExpressionBuilder,
} from 'typeorm';
import { ProgramEntity } from '../../programs/program.entity';
import { ProgramService } from '../../programs/programs.service';
import { PermissionEnum } from '../../user/permission.enum';
import { UserEntity } from '../../user/user.entity';
import {
  AllowedFilterOperatorsString,
  PaginateConfigRegistrationView,
} from '../const/filter-operation.const';
import {
  RegistrationDataInfo,
  RegistrationDataRelation,
} from '../dto/registration-data-relation.model';
import { RegistrationDataEntity } from '../registration-data.entity';
import { RegistrationViewEntity } from '../registration-view.entity';

type Filter = {
  comparator: FilterComparator;
  findOperator: FindOperator<string>;
};
type ColumnsFilters = { [columnName: string]: Filter[] };

@Injectable()
export class RegistrationsPaginationService {
  @InjectRepository(RegistrationViewEntity)
  private readonly registrationViewRepository: Repository<RegistrationViewEntity>;
  @InjectRepository(ProgramEntity)
  private readonly programRepository: Repository<ProgramEntity>;
  @InjectRepository(UserEntity)
  private readonly userRepository: Repository<UserEntity>;

  public constructor(private readonly programService: ProgramService) {}

  public async getPaginate(
    query: PaginateQuery,
    programId: number,
    hasPersonalReadPermission: boolean,
  ): Promise<Paginated<RegistrationViewEntity>> {
    const paginateConfigCopy = { ...PaginateConfigRegistrationView };

    const orignalSelect = query.select ? [...query.select] : [];
    const fullnameNamingConvention = await this.getFullNameNamingConvention(
      programId,
    );

    if (query.select && query.select.includes('name')) {
      if (fullnameNamingConvention) {
        query.select = query.select.concat(fullnameNamingConvention);
      }
    }

    let queryBuilder = this.registrationViewRepository
      .createQueryBuilder('registration')
      .where('"programId" = :programId', { programId: programId });

    const registrationDataRelations =
      await this.programService.getAllRelationProgram(programId);
    const registrationDataNamesProgram = registrationDataRelations.map(
      (r) => r.name,
    );

    // Check if the filter contains at least one registration data name
    if (
      hasPersonalReadPermission &&
      query.filter &&
      registrationDataNamesProgram.some((key) =>
        Object.keys(query.filter).includes(key),
      )
    ) {
      queryBuilder = this.filterOnRegistrationData(
        query,
        queryBuilder,
        registrationDataRelations,
        registrationDataNamesProgram,
      );
    }
    if (hasPersonalReadPermission) {
      paginateConfigCopy.relations = ['data'];
      paginateConfigCopy.searchableColumns = ['data.(value)'];
    }

    // PaginateConfig.select and PaginateConfig.relations cannot be used in combi with each other
    // That's why we wrote some manual code to do the selection
    const result = await paginate<RegistrationViewEntity>(
      query,
      queryBuilder,
      paginateConfigCopy,
    );

    // Custom code is written here to filter on query.select since it does not work with query.relations
    let registrationDataRelationsSelect = [...registrationDataRelations];
    if (query.select && query.select.length > 0) {
      registrationDataRelationsSelect = registrationDataRelationsSelect.filter(
        (relation) => query.select.includes(relation.name),
      );
    }

    result.data = this.mapPaginatedEntity(
      result,
      registrationDataRelationsSelect,
      query.select,
      orignalSelect,
      fullnameNamingConvention,
      hasPersonalReadPermission,
    );
    return result;
  }

  public async userHasPermissionForProgram(
    userId: number,
    programId: number,
    permission: PermissionEnum,
  ): Promise<boolean> {
    const count = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.programAssignments', 'assignment')
      .leftJoin('assignment.program', 'program')
      .leftJoin('assignment.roles', 'roles')
      .leftJoin('roles.permissions', 'permissions')
      .where('user.id = :userId', { userId: userId })
      .andWhere('program.id = :programId', { programId: programId })
      .andWhere('permissions.name = :permissions', {
        permissions: permission,
      })
      .getCount();
    return count > 0;
  }

  private async getFullNameNamingConvention(
    programId: number,
  ): Promise<string[]> {
    const program = await this.programRepository.findOne({
      where: { id: programId },
      select: ['fullnameNamingConvention'],
    });
    if (program.fullnameNamingConvention)
      return JSON.parse(JSON.stringify(program.fullnameNamingConvention));
    else {
      return [];
    }
  }

  private filterOnRegistrationData(
    query: PaginateQuery,
    queryBuilder: SelectQueryBuilder<RegistrationViewEntity>,
    registrationDataRelations: RegistrationDataInfo[],
    registrationDataNamesProgram: string[],
  ): SelectQueryBuilder<RegistrationViewEntity> {
    const filterableColumnsRegData = this.createFilterObjectRegistrationData(
      registrationDataNamesProgram,
    );
    const parsedFilter = parseFilter(query, filterableColumnsRegData);
    return this.filterRegistrationDataQb(
      queryBuilder,
      registrationDataRelations,
      parsedFilter,
    );
  }

  private createFilterObjectRegistrationData(
    registrationDataNamesProgram: string[],
  ): { [column: string]: FilterOperator[] | true } {
    const filterObject = {};
    for (const name of registrationDataNamesProgram) {
      filterObject[name] = AllowedFilterOperatorsString;
    }
    return filterObject;
  }

  private filterRegistrationDataQb(
    queryBuilder: SelectQueryBuilder<RegistrationViewEntity>,
    registrationDataRelations: RegistrationDataInfo[],
    parsedFilter: ColumnsFilters,
  ): SelectQueryBuilder<RegistrationViewEntity> {
    for (const [filterKey, filters] of Object.entries(parsedFilter)) {
      const relationInfoArray = registrationDataRelations.filter(
        (r) => r.name === filterKey,
      );
      for (const filter of filters) {
        if (
          ['equal', 'in', 'ilike', 'isNull'].includes(filter.findOperator.type)
        ) {
          const uniqueJoinId = Array.from({ length: 25 }, () =>
            'abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 26)),
          ).join('');
          queryBuilder.leftJoin('registration.data', uniqueJoinId);
          queryBuilder = this.applyFilterConditionRegData(
            queryBuilder,
            filter.findOperator.type,
            filter.findOperator.value,
            uniqueJoinId,
          );
          queryBuilder.andWhere(
            new Brackets((qb) => {
              this.whereRegistrationDataIsOneOfIds(
                relationInfoArray,
                qb,
                uniqueJoinId,
              );
            }),
          );
        }
      }
    }
    return queryBuilder;
  }

  private applyFilterConditionRegData(
    queryBuilder: SelectQueryBuilder<RegistrationViewEntity>,
    filterType: string,
    value: any,
    uniqueJoinId: string,
  ): SelectQueryBuilder<RegistrationViewEntity> {
    const columnName = 'value';
    switch (filterType) {
      case 'equal':
        return queryBuilder.andWhere(
          `${uniqueJoinId}.${columnName} = :value${uniqueJoinId}`,
          { [`value${uniqueJoinId}`]: value },
        );
      case 'in':
        return queryBuilder.andWhere(
          `${uniqueJoinId}.${columnName} IN (:...value${uniqueJoinId})`,
          { [`value${uniqueJoinId}`]: value },
        );
      case 'ilike':
        return queryBuilder.andWhere(
          `${uniqueJoinId}.${columnName} ILIKE :value${uniqueJoinId}`,
          { [`value${uniqueJoinId}`]: `%${value}%` },
        );
      case 'isNull':
        return queryBuilder.andWhere(`${uniqueJoinId}.${columnName} IS NULL`);
    }
  }

  private whereRegistrationDataIsOneOfIds(
    relationInfoArray: RegistrationDataInfo[],
    qb: WhereExpressionBuilder,
    uniqueJoinId: string,
  ): void {
    let i = 0;
    for (const relationInfo of relationInfoArray) {
      for (const [dataRelKey, id] of Object.entries(relationInfo.relation)) {
        if (i === 0) {
          qb.where(`${uniqueJoinId}."${dataRelKey}" = :id${uniqueJoinId}`, {
            [`id${uniqueJoinId}`]: id,
          });
        } else {
          qb.orWhere(`${uniqueJoinId}."${dataRelKey}" = :id${uniqueJoinId}`, {
            [`id${uniqueJoinId}`]: id,
          });
        }
      }
      i++;
    }
  }

  private mapPaginatedEntity(
    paginatedResult: Paginated<RegistrationViewEntity>,
    registrationDataRelations: RegistrationDataInfo[],
    select: string[],
    orignalSelect: string[],
    fullnameNamingConvention: string[],
    hasPersonalReadPermission: boolean,
  ): RegistrationViewEntity[] {
    const mappedData: RegistrationViewEntity[] = [];
    for (const registration of paginatedResult.data) {
      const mappedRootRegistration = this.mapRootRegistration(
        registration,
        select,
        hasPersonalReadPermission,
      );
      // Add personal data permission check here
      let mappedRegistration = this.mapRegistrationData(
        registration.data,
        mappedRootRegistration,
        registrationDataRelations,
      );
      mappedData.push(mappedRegistration);

      if ((!select || select.includes('name')) && hasPersonalReadPermission) {
        mappedRegistration = this.mapRegistrationName(
          mappedRegistration,
          select,
          orignalSelect,
          fullnameNamingConvention,
        );
      }
    }
    return mappedData;
  }

  private mapRootRegistration(
    registration: RegistrationViewEntity,
    select: string[],
    hasPersonalReadPermission: boolean,
  ): RegistrationViewEntity {
    let mappedRegistration: RegistrationViewEntity;
    if (select && select.length > 0) {
      mappedRegistration = new RegistrationViewEntity();
      for (const selectKey of select) {
        if (registration[selectKey] !== undefined) {
          mappedRegistration[selectKey] = registration[selectKey];
        }
      }
    } else {
      mappedRegistration = { ...registration };
    }
    delete mappedRegistration.data;
    if (!hasPersonalReadPermission) {
      delete mappedRegistration.phoneNumber;
    }
    return mappedRegistration;
  }

  private mapRegistrationData(
    registrationDataArray: RegistrationDataEntity[],
    mappedRegistration: RegistrationViewEntity,
    registrationDataInfoArray: RegistrationDataInfo[],
  ): RegistrationViewEntity {
    if (!registrationDataArray || registrationDataArray.length < 1) {
      return mappedRegistration;
    }
    const findRelation = (
      dataRelation: RegistrationDataRelation,
      data: RegistrationDataEntity,
    ): boolean => {
      const propertiesToCheck = [
        'programQuestionId',
        'fspQuestionId',
        'programCustomAttributeId',
        'monitoringQuestionId',
      ];
      for (const property of propertiesToCheck) {
        if (
          dataRelation[property] === data[property] &&
          data[property] !== null
        ) {
          return true;
        }
      }
      return false;
    };
    for (const registrationData of registrationDataArray) {
      const dataRelation = registrationDataInfoArray.find((x) =>
        findRelation(x.relation, registrationData),
      );
      if (dataRelation && dataRelation.name) {
        mappedRegistration[dataRelation.name] = registrationData.value;
      }
    }
    return mappedRegistration;
  }

  private mapRegistrationName(
    registration: RegistrationViewEntity,
    select: string[],
    orignalSelect: string[],
    fullnameNamingConvention: string[],
  ): RegistrationViewEntity {
    registration['name'] = this.getName(registration, fullnameNamingConvention);
    if (select && select.includes('name')) {
      const differenceOrignalSelect = select.filter(
        (x) => !orignalSelect.includes(x),
      );
      for (const key of differenceOrignalSelect) {
        delete registration[key];
      }
    }
    return registration;
  }

  private getName(
    registrationRow: object,
    fullnameNamingConvention: string[],
  ): string {
    const fullnameConcat = [];
    const nameColumns = JSON.parse(JSON.stringify(fullnameNamingConvention));
    for (const nameColumn of nameColumns) {
      fullnameConcat.push(registrationRow[nameColumn]);
    }
    return fullnameConcat.join(' ');
  }
}
