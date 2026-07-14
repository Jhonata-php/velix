import { IsString } from 'class-validator';

export class SetMirrorDto {
  @IsString()
  targetServerId: string;
}
