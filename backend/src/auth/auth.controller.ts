import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { RequestContext } from '../common/request-context';
import { Public } from './auth.decorators';
import { AuthService, type LoginResult } from './auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CollaboratorLoginDto } from './dto/collaborator-login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('admin/login')
  @HttpCode(200)
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.entregar(await this.auth.loginAdmin(dto, request), response);
  }

  @Public()
  @Post('collaborator/login')
  @HttpCode(200)
  async collaboratorLogin(
    @Body() dto: CollaboratorLoginDto,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.entregar(await this.auth.loginCollaborator(dto, request), response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: RequestContext, @Res({ passthrough: true }) response: Response) {
    return this.entregar(await this.auth.rotateRefresh(request.cookies?.refresh_token, request), response);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: RequestContext, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(request.cookies?.refresh_token);
    response.clearCookie('refresh_token', { path: '/api/auth' });
  }

  /**
   * El refresh token viaja solo en una cookie HttpOnly: nunca llega al
   * JavaScript de la PWA, así que un XSS no puede llevárselo. El access token
   * sí va en el cuerpo, porque el cliente debe adjuntarlo en cada petición.
   */
  private entregar(result: LoginResult, response: Response) {
    response.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: result.refreshExpiresIn * 1000,
    });
    return { kind: result.kind, accessToken: result.accessToken, expiresIn: result.expiresIn };
  }
}
