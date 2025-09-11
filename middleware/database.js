// MIDDLEWARE DE BASE DE DATOS
// Archivo: backend/middleware/database.js

const Database = require('../config/database');

// Middleware que agrega métodos de base de datos al objeto req
const databaseMiddleware = async (req, res, next) => {
    try {
        // Obtener la instancia de la base de datos
        let dbInstance = Database.getInstance();
        
        // Si no existe, inicializar
        if (!dbInstance) {
            const db = await Database.initialize();
            dbInstance = db.db; // Obtener la instancia SQLite3 interna
        }

        // Agregar métodos simplificados al objeto req
        req.db = {
            // Método para ejecutar queries SELECT que devuelven múltiples filas
            all: (sql, params = []) => {
                return new Promise((resolve, reject) => {
                    dbInstance.all(sql, params, (err, rows) => {
                        if (err) {
                            console.error('❌ Error en db.all:', err);
                            reject(err);
                        } else {
                            resolve(rows || []);
                        }
                    });
                });
            },

            // Método para ejecutar queries SELECT que devuelven una sola fila
            get: (sql, params = []) => {
                return new Promise((resolve, reject) => {
                    dbInstance.get(sql, params, (err, row) => {
                        if (err) {
                            console.error('❌ Error en db.get:', err);
                            reject(err);
                        } else {
                            resolve(row || null);
                        }
                    });
                });
            },

            // Método para ejecutar queries INSERT, UPDATE, DELETE
            run: (sql, params = []) => {
                return new Promise((resolve, reject) => {
                    dbInstance.run(sql, params, function(err) {
                        if (err) {
                            console.error('❌ Error en db.run:', err);
                            reject(err);
                        } else {
                            resolve({ 
                                lastID: this.lastID, 
                                changes: this.changes 
                            });
                        }
                    });
                });
            },

            // Método directo para usar los helpers de la clase Database
            ejecutarSQL: async (sql, params = []) => {
                const databaseInstance = await Database.initialize();
                return databaseInstance.ejecutarSQL(sql, params);
            }
        };

        next();
    } catch (error) {
        console.error('❌ Error en middleware de base de datos:', error);
        res.status(500).json({ 
            error: 'Error de conexión a la base de datos',
            details: error.message 
        });
    }
};

module.exports = databaseMiddleware;