import { ArrayMinSize, IsArray, IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) roleCodes!: string[];
}
