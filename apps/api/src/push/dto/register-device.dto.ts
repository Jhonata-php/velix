import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';

  @IsString()
  @IsNotEmpty()
  fcmToken!: string;
}
