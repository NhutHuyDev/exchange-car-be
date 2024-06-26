import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { RequestVerifyPhoneDTO } from './dto/request-verify-phone.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { VerifyOTP, VerifyType } from './entities/verify_otp.entity';
import generateOTP from '@/utils/generateOTP.util';
import { Customer } from '@/modules/customer/entities/customer.entity';
import { SignUpDTO } from './dto/sign-up.dto';
import { AuthCredential } from './entities/auth_credential.entity';
import { plainToClass } from 'class-transformer';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces/jwtPayload.interface';
import { Role } from './entities/role.entity';
import { CustomerWishlist } from '../customer/entities/customer_wishlist.entity';
import { LocalAuthGuard } from './guards/local.guard';
import { compare, hash } from '@/utils/hash.util';
import SystemRole from '@/constraints/systemRoles.enum.constraint';
import { Session } from './entities/session.entity';
import { Staff } from '../staffs/entities/staff.entity';
import {
  access_token_private_key,
  refresh_token_private_key,
} from '@/constraints/jwt.constraint';
import { ResetPasswordDTO } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Role)
    private RoleRepository: Repository<Role>,
    @InjectRepository(VerifyOTP)
    private verifyOTPRepository: Repository<VerifyOTP>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(AuthCredential)
    private authCredentialRepository: Repository<AuthCredential>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    @InjectRepository(Staff)
    private staffRepository: Repository<Staff>,
    private dataSource: DataSource,
    private jwtService: JwtService,
  ) {}

  async requestVerifyPhone(requestVerifyPhoneDTO: RequestVerifyPhoneDTO) {
    const { mobilePhone } = requestVerifyPhoneDTO;

    const isUsedPhoneNumber = await this.customerRepository.findOneBy({
      mobile_phone: mobilePhone,
    });

    if (isUsedPhoneNumber) {
      throw new BadRequestException('phone number is used');
    }

    let currentVerify = await this.verifyOTPRepository.findOneBy({
      verify_type: VerifyType.PHONE,
      verify_info: mobilePhone,
    });

    const newOTP = generateOTP(6);
    const expiry = new Date(
      Date.now() + parseInt(process.env.OTP_EXPIRY_DURATION, 10),
    );

    if (currentVerify) {
      currentVerify.current_otp = hash(newOTP);
      currentVerify.otp_expiry = expiry;
    } else {
      currentVerify = new VerifyOTP();
      currentVerify.verify_type = VerifyType.PHONE;
      currentVerify.verify_info = mobilePhone;
      currentVerify.current_otp = hash(newOTP);
      currentVerify.otp_expiry = expiry;
    }

    await this.verifyOTPRepository.save(currentVerify);

    return {
      mobilePhone: mobilePhone,
      currentOTP: newOTP,
    };
  }

  async signUp(signUpDTO: SignUpDTO) {
    const { firstName, lastName, mobilePhone, password, verifyOTP } = signUpDTO;

    const isUsedPhoneNumber = await this.customerRepository.findOneBy({
      mobile_phone: mobilePhone,
    });

    if (isUsedPhoneNumber) {
      throw new BadRequestException('phone number is used');
    }

    const infoOTP = await this.verifyOTPRepository.findOneBy({
      verify_type: VerifyType.PHONE,
      verify_info: mobilePhone,
      otp_expiry: MoreThanOrEqual(new Date()),
    });

    if (!infoOTP) {
      throw new BadRequestException('phone number is not verified');
    }

    const isValidOTP = compare(verifyOTP, infoOTP.current_otp);

    if (isValidOTP === false) {
      throw new BadRequestException('otp is not valid');
    }

    return await this.dataSource.transaction(async (manager) => {
      const individualCustomerRole = await this.RoleRepository.findOneBy({
        role_title: SystemRole.Individual_Customer,
      });

      const authCredential = await manager.save(AuthCredential, {
        cred_login: mobilePhone,
        cred_password: hash(password),
        roles: [individualCustomerRole],
      });

      const newCustomer = await manager.save(Customer, {
        first_name: firstName,
        last_name: lastName,
        auth_credential: authCredential,
        mobile_phone: mobilePhone,
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const customerWishlist = await manager.save(CustomerWishlist, {
        customer: newCustomer,
      });

      return { newCustomer: plainToClass(Customer, newCustomer) };
    });
  }

  @UseGuards(LocalAuthGuard)
  async signIn(jwtPayload: JwtPayload) {
    const accessToken = this.generateAccessToken(jwtPayload);
    const refreshToken = this.generateRefreshToken(jwtPayload);

    await this.storeRefreshToken(jwtPayload.authId, refreshToken);

    return {
      accessToken,
      refreshToken,
    };
  }

  async getAuthentication(mobilePhone: string, password: string) {
    const authCredential = await this.authCredentialRepository.findOne({
      where: { cred_login: mobilePhone },
    });

    if (!authCredential) {
      throw new UnauthorizedException('mobilePhone or password is not correct');
    }

    const isCorrectPassword = compare(password, authCredential.cred_password);

    if (isCorrectPassword === false) {
      throw new UnauthorizedException('mobilePhone or password is not correct');
    }

    return plainToClass(AuthCredential, authCredential);
  }

  async getAuthenticationWithRole(mobilePhone: string, password: string) {
    const authCredential = await this.authCredentialRepository.findOne({
      where: { cred_login: mobilePhone },
      relations: {
        roles: true,
      },
    });

    if (!authCredential) {
      throw new UnauthorizedException('mobilePhone or password is not correct');
    }

    const isCorrectPassword = compare(password, authCredential.cred_password);

    if (isCorrectPassword === false) {
      throw new UnauthorizedException('mobilePhone or password is not correct');
    }

    return plainToClass(AuthCredential, authCredential);
  }

  generateAccessToken(payload: JwtPayload) {
    return this.jwtService.sign(payload, {
      algorithm: 'RS256',
      privateKey: access_token_private_key,
      expiresIn: `${process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME}s`,
    });
  }

  generateRefreshToken(payload: JwtPayload) {
    return this.jwtService.sign(payload, {
      algorithm: 'RS256',
      privateKey: refresh_token_private_key,
      expiresIn: `${process.env.JWT_REFRESH_TOKEN_EXPIRATION_TIME}s`,
    });
  }

  async storeRefreshToken(authId: number, refreshToken: string) {
    const authCredential = await this.authCredentialRepository.findOneBy({
      id: authId,
    });

    await this.sessionRepository.save({
      auth_credential: authCredential,
      refresh_token: hash(refreshToken),
    });
  }

  async getAuthIfRefreshTokenMatched(
    authId: number,
    refreshToken: string,
  ): Promise<JwtPayload> {
    const authCredential = await this.authCredentialRepository.findOne({
      where: {
        id: authId,
      },
      relations: {
        roles: true,
      },
    });

    if (!authCredential) {
      throw new UnauthorizedException();
    }

    const session = await this.sessionRepository.findOneBy({
      auth_credential: authCredential,
      refresh_token: hash(refreshToken),
      is_available: true,
    });

    if (!session) {
      throw new UnauthorizedException();
    }

    const roles: SystemRole[] = authCredential.roles.map(
      (role) => role.role_title,
    );

    return {
      authId: authCredential.id,
      roles: roles,
    };
  }

  async requestResetPassword(requestResetPasswordDTO: RequestVerifyPhoneDTO) {
    const { mobilePhone } = requestResetPasswordDTO;
    const authCredential = await this.authCredentialRepository.findOneBy({
      cred_login: mobilePhone,
    });

    if (!authCredential) {
      throw new BadRequestException('mobile phone is not existed');
    }

    const newOTP = generateOTP(6);

    authCredential.password_reset_otp = hash(newOTP);
    authCredential.password_reset_expiry = new Date(
      Date.now() + parseInt(process.env.OTP_EXPIRY_DURATION, 10),
    );

    await this.authCredentialRepository.save(authCredential);

    return {
      password_reset_otp: newOTP,
    };
  }

  async resetPassword(resetPasswordDTO: ResetPasswordDTO) {
    const { mobilePhone, newPassword, otp } = resetPasswordDTO;
    const authCredential = await this.authCredentialRepository.findOneBy({
      cred_login: mobilePhone,
    });

    if (!authCredential) {
      throw new BadRequestException('mobile phone is not existed');
    }

    if (
      authCredential.password_reset_expiry &&
      authCredential.password_reset_expiry > new Date()
    ) {
      if (compare(otp, authCredential.password_reset_otp)) {
        authCredential.cred_password = hash(newPassword);
        authCredential.password_reset_otp = null;
        authCredential.password_reset_expiry = null;

        this.authCredentialRepository.save(authCredential);

        return {
          message: 'reset password successfully',
        };
      }
    }

    throw new BadRequestException('invalid otp');
  }
}
