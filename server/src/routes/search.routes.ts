import { Router } from 'express';
import { searchController } from '../controllers/search.controller.js';

export const searchRoutes = Router();

searchRoutes.get('/', searchController.search);
