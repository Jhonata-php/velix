import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class BulkReplicateDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  primaryInstanceIds: string[];

  @IsString()
  targetServerId: string;
}
