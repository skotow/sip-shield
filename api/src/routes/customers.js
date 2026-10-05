import { Router } from 'express';
import { db } from '../db.js';
import { customer, id } from '../validation.js';
import { queueRuntime } from '../services/runtime.js';
export const customers = Router();
customers.get('/', async (req, res) => res.json((await db.query('SELECT * FROM customers ORDER BY id')).rows));
customers.post('/', async (req, res) => {
  const result = await db.query('INSERT INTO customers(name,domain,backend_host,backend_port,enabled) VALUES($1,$2,$3,$4,$5) RETURNING *', customer(req.body));
  await queueRuntime('all');
  res.status(201).json(result.rows[0]);
});
customers.put('/:id', async (req, res) => {
  const result = await db.query('UPDATE customers SET name=$1,domain=$2,backend_host=$3,backend_port=$4,enabled=$5 WHERE id=$6 RETURNING *', [...customer(req.body), id(req.params.id)]);
  if (result.rowCount) await queueRuntime('all');
  res.status(result.rowCount ? 200 : 404).json(result.rows[0] ?? { error: 'Customer not found' });
});
customers.delete('/:id', async (req, res) => {
  const result = await db.query('DELETE FROM customers WHERE id=$1', [id(req.params.id)]);
  if (result.rowCount) await queueRuntime('all');
  res.status(result.rowCount ? 204 : 404).send();
});
