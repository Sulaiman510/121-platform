import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  Unique,
} from 'typeorm';
import { Base121Entity } from '../base.entity';
import { UserRoleEntity } from '../user/user-role.entity';
import { UserEntity } from '../user/user.entity';
import { ProgramEntity } from './program.entity';

@Unique('userProgramAssignmentUnique', ['userId', 'programId'])
@Entity('program_aidworker_assignment')
export class ProgramAidworkerAssignmentEntity extends Base121Entity {
  @ManyToOne(() => UserEntity, (user) => user.programAssignments)
  @JoinColumn({ name: 'userId' })
  public user: UserEntity;
  @Column()
  public userId: number;

  @ManyToOne(() => ProgramEntity, (program) => program.aidworkerAssignments)
  @JoinColumn({ name: 'programId' })
  public program: ProgramEntity;
  @Column()
  public programId: number;

  @ManyToMany(() => UserRoleEntity, (role) => role.assignments)
  @JoinTable()
  public roles: UserRoleEntity[];

  @Column({ nullable: true })
  public scope: string; //
}
