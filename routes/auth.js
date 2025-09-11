// Archivo: backend/routes/auth.js

const express = require('express');
const bcrypt = require('bcryptjs');
const { generarToken, generarRefreshToken, verificarToken } = require('../middleware/auth');
const router = express.Router();

// Registro de nuevo usuario
router.post('/registro', async (req, res) => {
    try {
        const { nombre, email, password, confirmarPassword } = req.body;

        // Validaciones básicas
        if (!nombre || !email || !password) {
            return res.status(400).json({
                error: 'Nombre, email y contraseña son requeridos'
            });
        }

        if (password !== confirmarPassword) {
            return res.status(400).json({
                error: 'Las contraseñas no coinciden'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Formato de email inválido'
            });
        }

        // Verificar si el usuario ya existe
        const usuarioExistente = await req.db.get(
            'SELECT id FROM usuarios WHERE email = ?',
            [email.toLowerCase()]
        );

        if (usuarioExistente) {
            return res.status(409).json({
                error: 'Ya existe un usuario con este email'
            });
        }

        // Encriptar contraseña
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Crear usuario
        const resultado = await req.db.run(`
            INSERT INTO usuarios (nombre, email, password_hash, rol)
            VALUES (?, ?, ?, ?)
        `, [nombre.trim(), email.toLowerCase(), passwordHash, 'usuario']);

        // Obtener el usuario creado (sin la contraseña)
        const nuevoUsuario = await req.db.get(`
            SELECT id, nombre, email, rol, fecha_creacion
            FROM usuarios 
            WHERE id = ?
        `, [resultado.lastID]);

        // Generar tokens
        const token = generarToken(nuevoUsuario);
        const refreshToken = generarRefreshToken(nuevoUsuario);

        res.status(201).json({
            message: 'Usuario registrado exitosamente',
            usuario: nuevoUsuario,
            token,
            refreshToken
        });

    } catch (error) {
        console.error('Error registrando usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Login de usuario
router.post('/login', async (req, res) => {
    try {
        console.log('=== POST /api/auth/login ===');
        console.log('req.body:', req.body);
        
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email y contraseña son requeridos'
            });
        }

        // Buscar usuario por email
        const usuario = await req.db.get(`
            SELECT id, nombre, email, password_hash, rol, activo, 
                   intentos_fallidos, bloqueado_hasta
            FROM usuarios 
            WHERE email = ?
        `, [email.toLowerCase()]);

        console.log('Usuario encontrado:', usuario ? 'Sí' : 'No');

        if (!usuario) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        // Verificar si el usuario está activo
        if (!usuario.activo) {
            return res.status(401).json({
                error: 'Cuenta desactivada. Contacta al administrador'
            });
        }

        // Verificar si está bloqueado
        if (usuario.bloqueado_hasta && new Date() < new Date(usuario.bloqueado_hasta)) {
            return res.status(429).json({
                error: 'Cuenta temporalmente bloqueada. Intenta más tarde',
                bloqueado_hasta: usuario.bloqueado_hasta
            });
        }

        // Verificar contraseña
        const passwordValido = await bcrypt.compare(password, usuario.password_hash);

        console.log('Password válido:', passwordValido);

        if (!passwordValido) {
            // Incrementar intentos fallidos
            const nuevosIntentos = usuario.intentos_fallidos + 1;
            let bloquearHasta = null;

            // Bloquear cuenta después de 5 intentos fallidos (30 minutos)
            if (nuevosIntentos >= 5) {
                bloquearHasta = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
            }

            await req.db.run(`
                UPDATE usuarios 
                SET intentos_fallidos = ?, bloqueado_hasta = ?
                WHERE id = ?
            `, [nuevosIntentos, bloquearHasta, usuario.id]);

            return res.status(401).json({
                error: 'Credenciales inválidas',
                intentos_restantes: 5 - nuevosIntentos
            });
        }

        // Login exitoso - resetear intentos fallidos
        await req.db.run(`
            UPDATE usuarios 
            SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [usuario.id]);

        // Preparar datos del usuario (sin contraseña)
        const usuarioSeguro = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            rol: usuario.rol
        };

        // Generar tokens
        const token = generarToken(usuarioSeguro);
        const refreshToken = generarRefreshToken(usuarioSeguro);

        console.log('Login exitoso para:', usuarioSeguro.email);

        res.json({
            message: 'Login exitoso',
            usuario: usuarioSeguro,
            token,
            refreshToken
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Renovar token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                error: 'Refresh token requerido'
            });
        }

        // Verificar refresh token
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('../middleware/auth');
        
        const decoded = jwt.verify(refreshToken, JWT_SECRET);

        if (decoded.tipo !== 'refresh') {
            return res.status(401).json({
                error: 'Token inválido'
            });
        }

        // Obtener usuario actualizado
        const usuario = await req.db.get(`
            SELECT id, nombre, email, rol, activo
            FROM usuarios 
            WHERE id = ? AND activo = 1
        `, [decoded.id]);

        if (!usuario) {
            return res.status(401).json({
                error: 'Usuario no encontrado o inactivo'
            });
        }

        // Generar nuevos tokens
        const nuevoToken = generarToken(usuario);
        const nuevoRefreshToken = generarRefreshToken(usuario);

        res.json({
            token: nuevoToken,
            refreshToken: nuevoRefreshToken,
            usuario
        });

    } catch (error) {
        console.error('Error renovando token:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Refresh token expirado. Inicia sesión nuevamente'
            });
        }
        
        return res.status(401).json({
            error: 'Refresh token inválido'
        });
    }
});

// Obtener perfil del usuario actual
router.get('/perfil', verificarToken, async (req, res) => {
    try {
        const usuario = await req.db.get(`
            SELECT id, nombre, email, rol, fecha_creacion, ultimo_acceso
            FROM usuarios 
            WHERE id = ?
        `, [req.usuario.id]);

        if (!usuario) {
            return res.status(404).json({
                error: 'Usuario no encontrado'
            });
        }

        res.json({ usuario });

    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar perfil
router.put('/perfil', verificarToken, async (req, res) => {
    try {
        const { nombre } = req.body;

        if (!nombre || nombre.trim().length === 0) {
            return res.status(400).json({
                error: 'El nombre es requerido'
            });
        }

        await req.db.run(`
            UPDATE usuarios 
            SET nombre = ?, fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [nombre.trim(), req.usuario.id]);

        const usuarioActualizado = await req.db.get(`
            SELECT id, nombre, email, rol, fecha_creacion, fecha_actualizacion
            FROM usuarios 
            WHERE id = ?
        `, [req.usuario.id]);

        res.json({
            message: 'Perfil actualizado exitosamente',
            usuario: usuarioActualizado
        });

    } catch (error) {
        console.error('Error actualizando perfil:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Cambiar contraseña
router.put('/cambiar-password', verificarToken, async (req, res) => {
    try {
        const { passwordActual, passwordNuevo, confirmarPasswordNuevo } = req.body;

        if (!passwordActual || !passwordNuevo || !confirmarPasswordNuevo) {
            return res.status(400).json({
                error: 'Todos los campos son requeridos'
            });
        }

        if (passwordNuevo !== confirmarPasswordNuevo) {
            return res.status(400).json({
                error: 'Las contraseñas nuevas no coinciden'
            });
        }

        if (passwordNuevo.length < 6) {
            return res.status(400).json({
                error: 'La nueva contraseña debe tener al menos 6 caracteres'
            });
        }

        // Obtener contraseña actual
        const usuario = await req.db.get(`
            SELECT password_hash FROM usuarios WHERE id = ?
        `, [req.usuario.id]);

        // Verificar contraseña actual
        const passwordValido = await bcrypt.compare(passwordActual, usuario.password_hash);

        if (!passwordValido) {
            return res.status(401).json({
                error: 'Contraseña actual incorrecta'
            });
        }

        // Encriptar nueva contraseña
        const saltRounds = 12;
        const nuevoPasswordHash = await bcrypt.hash(passwordNuevo, saltRounds);

        // Actualizar contraseña
        await req.db.run(`
            UPDATE usuarios 
            SET password_hash = ?, fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [nuevoPasswordHash, req.usuario.id]);

        res.json({
            message: 'Contraseña actualizada exitosamente'
        });

    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Logout (opcional - para invalidar tokens del lado servidor si se implementa lista negra)
router.post('/logout', verificarToken, async (req, res) => {
    try {
        // Aquí podrías agregar el token a una lista negra en la base de datos
        // Por ahora, simplemente confirmamos el logout
        
        res.json({
            message: 'Logout exitoso'
        });
    } catch (error) {
        console.error('Error en logout:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Verificar si el token es válido (para el frontend)
router.get('/verificar', verificarToken, (req, res) => {
    res.json({
        valido: true,
        usuario: req.usuario
    });
});

module.exports = router;