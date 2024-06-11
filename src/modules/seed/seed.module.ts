import { TypeOrmModule } from '@nestjs/typeorm';
import postgres from '../../configs/postgres.config';
import { SeedService } from './seed.service';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Role } from '../auth/entities/role.entity';
import { RolesSeeder } from './seeders/roles.seeder';
import { AuthCredential } from '../auth/entities/auth_credential.entity';
import { Staff } from '../staffs/entities/staff.entity';
import { AdminSeeder } from './seeders/admin.seeder';
import { CarBrand } from '../cars/entities/car_brand.entity';
import { CarBrandsSeeder } from './seeders/carBrands.seeder';
import { CarModel } from '../cars/entities/car_model.entity';
import { CarModelsSeeder } from './seeders/carModels.seeder';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [postgres],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) =>
        configService.get('postgres'),
    }),
    TypeOrmModule.forFeature([Role, AuthCredential, Staff, CarBrand, CarModel]),
  ],
  controllers: [],
  providers: [
    SeedService,
    RolesSeeder,
    AdminSeeder,
    CarBrandsSeeder,
    CarModelsSeeder,
  ],
})
export class SeedModule {}
