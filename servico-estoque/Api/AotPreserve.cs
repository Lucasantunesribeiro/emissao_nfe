using System.Diagnostics.CodeAnalysis;
using System.Linq;

namespace ServicoEstoque.Api;

internal static class AotPreserve
{
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IQueryable<long>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IOrderedQueryable<long>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IQueryable<int>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IOrderedQueryable<int>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IQueryable<float>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IOrderedQueryable<float>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IQueryable<double>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(IQueryable<decimal>))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.PublicMethods, typeof(Queryable))]
    internal static void Touch()
    {
        _ = Queryable.AsQueryable(Array.Empty<long>());
        _ = Queryable.AsQueryable(Array.Empty<int>());
        _ = Queryable.AsQueryable(Array.Empty<float>());
        _ = Queryable.AsQueryable(Array.Empty<double>());
        _ = Queryable.AsQueryable(Array.Empty<decimal>());

        _ = typeof(IQueryable<>).MakeGenericType(typeof(long));
        _ = typeof(IQueryable<>).MakeGenericType(typeof(int));
        _ = typeof(IQueryable<>).MakeGenericType(typeof(float));
        _ = typeof(IQueryable<>).MakeGenericType(typeof(double));
        _ = typeof(IQueryable<>).MakeGenericType(typeof(decimal));
    }
}
