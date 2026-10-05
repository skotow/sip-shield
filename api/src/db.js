import pg from 'pg';
export const db = new pg.Pool(process.env.DATABASE_URL ? {connectionString:process.env.DATABASE_URL} : {});
