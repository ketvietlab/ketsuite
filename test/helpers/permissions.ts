/**
 * A permission policy that lets every signed-in user call every function.
 *
 * KetJS refuses to boot a deployment that signs users in without
 * `serve.permissions` (`E_PERMISSIONS_REQUIRED`), because a forgotten policy used to
 * open every function. These fixtures exercise behaviour other than authorization,
 * so they say outright that access is unrestricted instead of relying on that default.
 */
export const everyFunction = async (): Promise<null> => null
