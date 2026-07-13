import { Equals } from 'class-validator';

export class PromoteReplicaDto {
  // Exige confirmação explícita — nunca promove por engano via chamada de API.
  @Equals(true)
  confirm!: boolean;
}
