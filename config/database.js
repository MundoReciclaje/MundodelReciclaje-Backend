const { Pool } = require('pg');

class Database {
    constructor() {
        this.pool = null;
    }

    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    static async initialize() {
        const instance = Database.getInstance();
        if (!instance.pool) {
            await instance.init();
        }
        return instance;
    }

    static close() {
        if (Database.instance && Database.instance.pool) {
            Database.instance.pool.end(() => {
                console.log('✅ Pool de conexiones cerrado correctamente');
            });
        }
    }

    async init() {
        try {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Probar conexión
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            
            console.log('✅ Conectado a PostgreSQL en Supabase');
            
            await this.crearTablas();
        } catch (error) {
            console.error('❌ Error conectando a PostgreSQL:', error);
            throw error;
        }
    }

    async crearTablas() {
        try {
            await this.crearEstructuraCompleta();
            await this.insertarDatosIniciales();
            console.log('✅ Tablas y datos iniciales creados/verificados correctamente');
        } catch (error) {
            console.error('❌ Error creando estructura de base de datos:', error);
            throw error;
        }
    }

    async crearEstructuraCompleta() {
        const queries = [
            // Tabla materiales
            `CREATE TABLE IF NOT EXISTS materiales (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL UNIQUE,
                categoria VARCHAR(50) NOT NULL,
                precio_ordinario DECIMAL(10,2) DEFAULT 0,
                precio_camion DECIMAL(10,2) DEFAULT 0,
                precio_noche DECIMAL(10,2) DEFAULT 0,
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla compras generales
            `CREATE TABLE IF NOT EXISTS compras_generales (
                id SERIAL PRIMARY KEY,
                fecha DATE NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                tipo_precio VARCHAR(20) NOT NULL,
                cliente VARCHAR(100),
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Tabla compras materiales
            `CREATE TABLE IF NOT EXISTS compras_materiales (
                id SERIAL PRIMARY KEY,
                material_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                kilos DECIMAL(10,3) NOT NULL,
                precio_kilo DECIMAL(10,2) NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                tipo_precio VARCHAR(20) NOT NULL,
                cliente VARCHAR(100),
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materiales(id)
            )`,

            // Tabla ventas
            `CREATE TABLE IF NOT EXISTS ventas (
                id SERIAL PRIMARY KEY,
                material_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                kilos DECIMAL(10,3) NOT NULL,
                precio_kilo DECIMAL(10,2) NOT NULL,
                total_pesos DECIMAL(12,2) NOT NULL,
                cliente VARCHAR(100),
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materiales(id)
            )`,

            // Tabla categorías de gastos
            `CREATE TABLE IF NOT EXISTS categorias_gastos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(50) NOT NULL UNIQUE,
                descripcion TEXT,
                activo BOOLEAN DEFAULT true
            )`,

            // Tabla gastos
            `CREATE TABLE IF NOT EXISTS gastos (
                id SERIAL PRIMARY KEY,
                categoria_id INTEGER NOT NULL,
                fecha DATE NOT NULL,
                concepto VARCHAR(200) NOT NULL,
                valor DECIMAL(12,2) NOT NULL,
                observaciones TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (categoria_id) REFERENCES categorias_gastos(id)
            )`,
            
            // Tabla usuarios (para autenticación)
            `CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                rol VARCHAR(50) DEFAULT 'usuario',
                activo BOOLEAN DEFAULT true,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultimo_acceso TIMESTAMP,
                intentos_fallidos INTEGER DEFAULT 0,
                bloqueado_hasta TIMESTAMP NULL
            )`
        ];

        // Crear índices
        const indices = [
            'CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)',
            'CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios(activo)',
            'CREATE INDEX IF NOT EXISTS idx_materiales_categoria ON materiales(categoria)',
            'CREATE INDEX IF NOT EXISTS idx_compras_fecha ON compras_generales(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_compras_generales_cliente ON compras_generales(cliente)',
            'CREATE INDEX IF NOT EXISTS idx_compras_materiales_cliente ON compras_materiales(cliente)',
            'CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha)',
            'CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente)',
            'CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha)'
        ];

        // Ejecutar creación de tablas
        for (const query of queries) {
            await this.ejecutarSQL(query);
        }

        // Agregar columnas cliente a tablas existentes (migración automática)
        try {
            // Verificar y agregar columna cliente a compras_generales si no existe
            const columnasGenerales = await this.ejecutarSQL(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'compras_generales' 
                AND table_schema = 'public' 
                AND column_name = 'cliente'
            `);

            if (columnasGenerales.rows.length === 0) {
                await this.ejecutarSQL('ALTER TABLE compras_generales ADD COLUMN cliente VARCHAR(100)');
                console.log('✅ Columna cliente agregada a compras_generales');
            }

            // Verificar y agregar columna cliente a compras_materiales si no existe
            const columnasMateriales = await this.ejecutarSQL(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'compras_materiales' 
                AND table_schema = 'public' 
                AND column_name = 'cliente'
            `);

            if (columnasMateriales.rows.length === 0) {
                await this.ejecutarSQL('ALTER TABLE compras_materiales ADD COLUMN cliente VARCHAR(100)');
                console.log('✅ Columna cliente agregada a compras_materiales');
            }

            // Verificar y agregar columna cliente a ventas si no existe
            const columnasVentas = await this.ejecutarSQL(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'ventas' 
                AND table_schema = 'public' 
                AND column_name = 'cliente'
            `);

            if (columnasVentas.rows.length === 0) {
                await this.ejecutarSQL('ALTER TABLE ventas ADD COLUMN cliente VARCHAR(100)');
                console.log('✅ Columna cliente agregada a ventas');
            }

            console.log('✅ Columnas cliente verificadas/actualizadas');
        } catch (error) {
            console.log('ℹ️ Columnas cliente ya existen o error menor:', error.message);
        }

        // Ejecutar creación de índices
        for (const indice of indices) {
            try {
                await this.ejecutarSQL(indice);
            } catch (error) {
                // Ignorar errores de índices que ya existen
                console.log('ℹ️ Índice ya existe:', error.message);
            }
        }
    }

    async insertarDatosIniciales() {
        // Verificar si ya hay categorías de gastos
        const categoriasExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM categorias_gastos');

        if (parseInt(categoriasExistentes.rows[0].count) === 0) {
            const categorias = [
                ['Sueldos', 'Pagos de salarios y prestaciones'],
                ['Gas Camión', 'Combustible para vehículos'],
                ['Combustible Planta', 'Combustible para maquinaria'],
                ['Arreglos Camión', 'Mantenimiento de vehículos'],
                ['Arreglos Planta', 'Mantenimiento de maquinaria'],
                ['Varios', 'Gastos diversos']
            ];

            for (const [nombre, descripcion] of categorias) {
                await this.ejecutarSQL(
                    'INSERT INTO categorias_gastos (nombre, descripcion) VALUES ($1, $2)',
                    [nombre, descripcion]
                );
            }
            console.log('✅ Categorías de gastos creadas (6 categorías)');
        }

        // Verificar si ya hay materiales
        const materialesExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM materiales');

        if (parseInt(materialesExistentes.rows[0].count) === 0) {
            const materiales = [
                // METALES
                ['Chatarra', 'Metales', 0, 0, 0],
                ['Hierro', 'Metales', 0, 0, 0],
                ['Aluminio', 'Metales', 0, 0, 0],
                ['Cobre', 'Metales', 0, 0, 0],
                ['Bronce', 'Metales', 0, 0, 0],
                ['Acero Inoxidable', 'Metales', 0, 0, 0],
                ['Latón', 'Metales', 0, 0, 0],
                ['Plomo', 'Metales', 0, 0, 0],
                ['Zinc', 'Metales', 0, 0, 0],
                ['Estaño', 'Metales', 0, 0, 0],
                ['Níquel', 'Metales', 0, 0, 0],
                ['Antimonio', 'Metales', 0, 0, 0],
                ['Magnesio', 'Metales', 0, 0, 0],
                ['Titanio', 'Metales', 0, 0, 0],
                ['Tungsteno', 'Metales', 0, 0, 0],
                
                // PAPEL Y CARTÓN
                ['Cartón', 'Papel y Cartón', 0, 0, 0],
                ['Papel Blanco', 'Papel y Cartón', 0, 0, 0],
                ['Papel Mixto', 'Papel y Cartón', 0, 0, 0],
                ['Papel Periódico', 'Papel y Cartón', 0, 0, 0],
                ['Papel Kraft', 'Papel y Cartón', 0, 0, 0],
                ['Papel Archivo', 'Papel y Cartón', 0, 0, 0],
                ['Cartón Corrugado', 'Papel y Cartón', 0, 0, 0],
                ['Papel Magazine', 'Papel y Cartón', 0, 0, 0],
                ['Papel Carbón', 'Papel y Cartón', 0, 0, 0],
                ['Papel Fotocopia', 'Papel y Cartón', 0, 0, 0],
                
                // PLÁSTICOS
                ['PET', 'Plásticos', 0, 0, 0],
                ['HDPE', 'Plásticos', 0, 0, 0],
                ['PVC', 'Plásticos', 0, 0, 0],
                ['LDPE', 'Plásticos', 0, 0, 0],
                ['PP', 'Plásticos', 0, 0, 0],
                ['PS', 'Plásticos', 0, 0, 0],
                ['ABS', 'Plásticos', 0, 0, 0],
                ['Policarbonato', 'Plásticos', 0, 0, 0],
                ['Nylon', 'Plásticos', 0, 0, 0],
                ['Acrílico', 'Plásticos', 0, 0, 0],
                ['Polietileno', 'Plásticos', 0, 0, 0],
                ['Polipropileno', 'Plásticos', 0, 0, 0],
                ['Poliestireno', 'Plásticos', 0, 0, 0],
                ['Tereftalato', 'Plásticos', 0, 0, 0],
                ['Film Plástico', 'Plásticos', 0, 0, 0],
                
                // VIDRIO
                ['Vidrio Transparente', 'Vidrio', 0, 0, 0],
                ['Vidrio Verde', 'Vidrio', 0, 0, 0],
                ['Vidrio Ámbar', 'Vidrio', 0, 0, 0],
                ['Vidrio Templado', 'Vidrio', 0, 0, 0],
                ['Cristal', 'Vidrio', 0, 0, 0],
                ['Vidrio Laminado', 'Vidrio', 0, 0, 0],
                ['Vidrio Automotriz', 'Vidrio', 0, 0, 0],
                ['Fibra de Vidrio', 'Vidrio', 0, 0, 0],
                
                // TEXTILES
                ['Ropa Usada', 'Textiles', 0, 0, 0],
                ['Algodón', 'Textiles', 0, 0, 0],
                ['Lana', 'Textiles', 0, 0, 0],
                ['Seda', 'Textiles', 0, 0, 0],
                ['Fibras Sintéticas', 'Textiles', 0, 0, 0],
                ['Cuero', 'Textiles', 0, 0, 0],
                ['Zapatos', 'Textiles', 0, 0, 0],
                
                // ELECTRÓNICOS
                ['Computadores', 'Electrónicos', 0, 0, 0],
                ['Celulares', 'Electrónicos', 0, 0, 0],
                ['Televisores', 'Electrónicos', 0, 0, 0],
                ['Electrodomésticos', 'Electrónicos', 0, 0, 0],
                ['Cables', 'Electrónicos', 0, 0, 0],
                ['Circuitos', 'Electrónicos', 0, 0, 0],
                ['Baterías', 'Electrónicos', 0, 0, 0],
                
                // OTROS
                ['Neumáticos', 'Otros', 0, 0, 0],
                ['Aceite Usado', 'Otros', 0, 0, 0],
                ['Madera', 'Otros', 0, 0, 0],
                ['Huesos', 'Otros', 0, 0, 0],
                ['Chatarra Mixta', 'Otros', 0, 0, 0]
            ];

            for (const [nombre, categoria, precio_ordinario, precio_camion, precio_noche] of materiales) {
                await this.ejecutarSQL(
                    'INSERT INTO materiales (nombre, categoria, precio_ordinario, precio_camion, precio_noche) VALUES ($1, $2, $3, $4, $5)',
                    [nombre, categoria, precio_ordinario, precio_camion, precio_noche]
                );
            }
            console.log('✅ Materiales iniciales creados (61 materiales)');
        }

        // Crear usuario administrador por defecto
        const usuariosExistentes = await this.ejecutarSQL('SELECT COUNT(*) as count FROM usuarios WHERE email = $1', ['admin@reciclaje.com']);
        
        if (parseInt(usuariosExistentes.rows[0].count) === 0) {
            const bcrypt = require('bcryptjs');
            const passwordHash = await bcrypt.hash('admin123', 12);
            
            await this.ejecutarSQL(`
                INSERT INTO usuarios (nombre, email, password_hash, rol, activo) 
                VALUES ($1, $2, $3, $4, $5)
            `, ['Administrador', 'admin@reciclaje.com', passwordHash, 'administrador', true]);
            
            console.log('✅ Usuario administrador creado: admin@reciclaje.com / admin123');
        }
    }

    async ejecutarSQL(sql, params = []) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(sql, params);
            return result;
        } finally {
            client.release();
        }
    }

    // Métodos helper para operaciones comunes (adaptados para PostgreSQL)
    async obtenerTodos(tabla, condiciones = '', params = []) {
        const sql = `SELECT * FROM ${tabla} ${condiciones}`;
        const result = await this.ejecutarSQL(sql, params);
        return result.rows;
    }

    async obtenerPorId(tabla, id) {
        const sql = `SELECT * FROM ${tabla} WHERE id = $1`;
        const result = await this.ejecutarSQL(sql, [id]);
        return result.rows[0] || null;
    }

    async insertar(tabla, datos) {
        const columnas = Object.keys(datos);
        const placeholders = columnas.map((_, index) => `$${index + 1}`).join(', ');
        const valores = Object.values(datos);

        const sql = `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const result = await this.ejecutarSQL(sql, valores);
        return result.rows[0];
    }

    async actualizar(tabla, id, datos) {
        const columnas = Object.keys(datos);
        const setClause = columnas.map((col, index) => `${col} = $${index + 1}`).join(', ');
        const valores = [...Object.values(datos), id];

        const sql = `UPDATE ${tabla} SET ${setClause} WHERE id = $${valores.length} RETURNING *`;
        const result = await this.ejecutarSQL(sql, valores);
        return result.rows[0];
    }

    async eliminar(tabla, id) {
        const sql = `DELETE FROM ${tabla} WHERE id = $1 RETURNING *`;
        const result = await this.ejecutarSQL(sql, [id]);
        return result.rows[0];
    }

    // Método para obtener estadísticas (compatible con PostgreSQL)
    async obtenerEstadisticas(fechaInicio) {
        const queries = {
            totalCompras: `
                SELECT COALESCE(SUM(total_pesos), 0) as total 
                FROM (
                    SELECT total_pesos FROM compras_generales WHERE fecha >= $1
                    UNION ALL
                    SELECT total_pesos FROM compras_materiales WHERE fecha >= $1
                ) compras
            `,
            totalVentas: `
                SELECT COALESCE(SUM(total_pesos), 0) as total 
                FROM ventas 
                WHERE fecha >= $1
            `,
            totalGastos: `
                SELECT COALESCE(SUM(valor), 0) as total 
                FROM gastos 
                WHERE fecha >= $1
            `
        };

        const [compras, ventas, gastos] = await Promise.all([
            this.ejecutarSQL(queries.totalCompras, [fechaInicio]),
            this.ejecutarSQL(queries.totalVentas, [fechaInicio]),
            this.ejecutarSQL(queries.totalGastos, [fechaInicio])
        ]);

        return {
            totalCompras: parseFloat(compras.rows[0].total || 0),
            totalVentas: parseFloat(ventas.rows[0].total || 0),
            totalGastos: parseFloat(gastos.rows[0].total || 0)
        };
    }
}

module.exports = Database;
