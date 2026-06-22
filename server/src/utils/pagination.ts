export interface PaginationParams {
  page?: number;
  limit?: number;
}

export function getPagination(params: PaginationParams) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 25));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { page, limit, from, to };
}

export function formatPaginatedResponse<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    total,
    page,
    limit,
    total_pages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}
