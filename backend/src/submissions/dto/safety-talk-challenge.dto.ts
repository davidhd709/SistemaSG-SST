import { IsIn } from 'class-validator';

export class SafetyTalkChallengeDto {
  @IsIn(['charla-01', 'charla-02', 'charla-03']) videoId!: string;
}
