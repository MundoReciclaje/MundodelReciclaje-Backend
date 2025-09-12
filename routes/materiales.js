// RUTAS DE MATERIALES
// Archivo: backend/routes/materiales.js

const express = require('express');
const router = express.Router();

// Obtener todos los materiales
router.get('/', async (req, res) => {
    try {
        const { activo, categoria } = req.query;
        let sql = 'SELECT * FROM materiales';
        let params = [];
        let conditions = [];

        if (activo !== undefined) {
            conditions.push('activo = ?');
            params.push(activo === 'true' ? true : false);
        }

        if (categoria) {
            conditions.push('categoria = ?');
            params.push(categoria);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY categoria, nombre';

        const materiales = await req.db.all(sql, params);
        res.json(materiales);
    } catch (error) {
        console.error('Error obteniendo materiales:', error);
        res.status(500).json({ error: 'Error obteniendo materiales' });
    }
});

// Obtener un material por ID
router.get('/:id', async (req, res) => {
    try {
        const material = await req.db.get(
            'SELECT * FROM materiales WHERE id = ?',
            [req.params.id]
        );

        if (!material) {
            return res.status(404).json({ error: 'Material no encontrado' });
        }

        res.json(material);
    } catch (error) {
        console.error('Error obteniendo material:', error);
        res.status(500).json({ error: 'Error obteniendo material' });
    }
});

// Crear nuevo material
router.post('/', async (req, res) => {
    try {
        const {
            nombre,
            categoria,
            precio_ordinario = 0,
            precio_camion = 0,
            precio_noche = 0
        } = req.body;

        // Validar campos requeridos
        if (!nombre || !categoria) {
            return res.status(400).json({
                error: 'Nombre y categoría son requeridos'
            });
        }

        // Verificar si el material ya existe
        const materialExistente = await req.db.get(
            'SELECT id FROM materiales WHERE LOWER(nombre) = LOWER(?)',
            [nombre]
        );

        if (materialExistente) {
            return res.status(409).json({
                error: 'Ya existe un material con ese nombre'
            });
        }

        // Insertar nuevo material
        const resultado = await req.db.run(`
            INSERT INTO materiales (
                nombre, categoria, precio_ordinario, precio_camion, precio_noche
            ) VALUES (?, ?, ?, ?, ?)
        `, [nombre, categoria, precio_ordinario, precio_camion, precio_noche]);

        // Obtener el material recién creado
        const nuevoMaterial = await req.db.get(
            'SELECT * FROM materiales WHERE id = ?',
            [resultado.lastID]
        );

        res.status(201).json(nuevoMaterial);
    } catch (error) {
        console.error('Error creando material:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(409).json({ error: 'Ya existe un material con ese nombre' });
        } else {
            res.status(500).json({ error: 'Error creando material' });
        }
    }
});

// Actualizar material
router.put('/:id', async (req, res) => {
    try {
        const {
            nombre,
            categoria,
            precio_ordinario,
            precio_camion,
            precio_noche,
            activo
        } = req.body;

        // Verificar que el material existe
        const materialExistente = await req.db.get(
            'SELECT * FROM materiales WHERE id = ?',
            [req.params.id]
        );

        if (!materialExistente) {
            return res.status(404).json({ error: 'Material no encontrado' });
        }

        // Verificar nombre único (excluyendo el material actual)
        if (nombre && nombre !== materialExistente.nombre) {
            const nombreDuplicado = await req.db.get(
                'SELECT id FROM materiales WHERE LOWER(nombre) = LOWER(?) AND id != ?',
                [nombre, req.params.id]
            );

            if (nombreDuplicado) {
                return res.status(409).json({
                    error: 'Ya existe otro material con ese nombre'
                });
            }
        }

        // Preparar datos para actualizar
        const datosActualizacion = {
            fecha_actualizacion: new Date().toISOString()
        };

        if (nombre !== undefined) datosActualizacion.nombre = nombre;
        if (categoria !== undefined) datosActualizacion.categoria = categoria;
        if (precio_ordinario !== undefined) datosActualizacion.precio_ordinario = precio_ordinario;
        if (precio_camion !== undefined) datosActualizacion.precio_camion = precio_camion;
        if (precio_noche !== undefined) datosActualizacion.precio_noche = precio_noche;
        if (activo !== undefined) datosActualizacion.activo = activo ? true : false;

        // Actualizar material
        const campos = Object.keys(datosActualizacion);
        const placeholders = campos.map(() => '?').join(', ');
        const setClause = campos.map(campo => `${campo} = ?`).join(', ');
        const valores = [...Object.values(datosActualizacion), req.params.id];

        await req.db.run(
            `UPDATE materiales SET ${setClause} WHERE id = ?`,
            valores
        );

        // Obtener material actualizado
        const materialActualizado = await req.db.get(
            'SELECT * FROM materiales WHERE id = ?',
            [req.params.id]
        );

        res.json(materialActualizado);
    } catch (error) {
        console.error('Error actualizando material:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(409).json({ error: 'Ya existe un material con ese nombre' });
        } else {
            res.status(500).json({ error: 'Error actualizando material' });
        }
    }
});

// Eliminar material (soft delete)
router.delete('/:id', async (req, res) => {
    try {
        // Verificar que el material existe
        const material = await req.db.get(
            'SELECT * FROM materiales WHERE id = ?',
            [req.params.id]
        );

        if (!material) {
            return res.status(404).json({ error: 'Material no encontrado' });
        }

        // Verificar si tiene compras o ventas asociadas
        const tieneCompras = await req.db.get(
            'SELECT COUNT(*) as count FROM compras_materiales WHERE material_id = ?',
            [req.params.id]
        );

        const tieneVentas = await req.db.get(
            'SELECT COUNT(*) as count FROM ventas WHERE material_id = ?',
            [req.params.id]
        );

        if (tieneCompras.count > 0 || tieneVentas.count > 0) {
            // Soft delete - solo desactivar
            await req.db.run(
                'UPDATE materiales SET activo = false, fecha_actualizacion = ? WHERE id = ?',
                [new Date().toISOString(), req.params.id]
            );

            res.json({
                message: 'Material desactivado (tiene transacciones asociadas)',
                action: 'deactivated'
            });
        } else {
            // Hard delete - eliminar completamente
            await req.db.run(
                'DELETE FROM materiales WHERE id = ?',
                [req.params.id]
            );

            res.json({
                message: 'Material eliminado completamente',
                action: 'deleted'
            });
        }
    } catch (error) {
        console.error('Error eliminando material:', error);
        res.status(500).json({ error: 'Error eliminando material' });
    }
});

// Obtener categorías únicas
router.get('/categorias/list', async (req, res) => {
    try {
        const categorias = await req.db.all(`
            SELECT DISTINCT categoria 
            FROM materiales 
            WHERE activo = true 
            ORDER BY categoria
        `);

        res.json(categorias.map(cat => cat.categoria));
    } catch (error) {
        console.error('Error obteniendo categorías:', error);
        res.status(500).json({ error: 'Error obteniendo categorías' });
    }
});

// Actualizar precios masivamente por categoría
router.put('/categoria/:categoria/precios', async (req, res) => {
    try {
        const { categoria } = req.params;
        const { 
            precio_ordinario_incremento,
            precio_camion_incremento,
            precio_noche_incremento,
            tipo_incremento = 'porcentaje' // 'porcentaje' o 'valor_fijo'
        } = req.body;

        let sql = 'UPDATE materiales SET fecha_actualizacion = ?';
        let params = [new Date().toISOString()];

        if (precio_ordinario_incremento !== undefined) {
            if (tipo_incremento === 'porcentaje') {
                sql += ', precio_ordinario = precio_ordinario * (1 + ? / 100)';
            } else {
                sql += ', precio_ordinario = precio_ordinario + ?';
            }
            params.push(precio_ordinario_incremento);
        }

        if (precio_camion_incremento !== undefined) {
            if (tipo_incremento === 'porcentaje') {
                sql += ', precio_camion = precio_camion * (1 + ? / 100)';
            } else {
                sql += ', precio_camion = precio_camion + ?';
            }
            params.push(precio_camion_incremento);
        }

        if (precio_noche_incremento !== undefined) {
            if (tipo_incremento === 'porcentaje') {
                sql += ', precio_noche = precio_noche * (1 + ? / 100)';
            } else {
                sql += ', precio_noche = precio_noche + ?';
            }
            params.push(precio_noche_incremento);
        }

        sql += ' WHERE categoria = ? AND activo = true';
        params.push(categoria);

        const resultado = await req.db.run(sql, params);

        res.json({
            message: `Precios actualizados para ${resultado.changes} materiales en la categoría ${categoria}`,
            materialesActualizados: resultado.changes
        });
    } catch (error) {
        console.error('Error actualizando precios por categoría:', error);
        res.status(500).json({ error: 'Error actualizando precios por categoría' });
    }
});

// Buscar materiales
router.get('/buscar/:termino', async (req, res) => {
    try {
        const { termino } = req.params;
        const { limite = 10 } = req.query;

        const materiales = await req.db.all(`
            SELECT * FROM materiales 
            WHERE activo = true
            AND (
                LOWER(nombre) LIKE LOWER(?) 
                OR LOWER(categoria) LIKE LOWER(?)
            )
            ORDER BY 
                CASE 
                    WHEN LOWER(nombre) LIKE LOWER(?) THEN 1 
                    ELSE 2 
                END,
                nombre
            LIMIT ?
        `, [
            `%${termino}%`, 
            `%${termino}%`, 
            `${termino}%`, 
            parseInt(limite)
        ]);

        res.json(materiales);
    } catch (error) {
        console.error('Error buscando materiales:', error);
        res.status(500).json({ error: 'Error buscando materiales' });
    }
});

module.exports = router;
